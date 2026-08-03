import { useEffect, useMemo, useRef, useState } from 'react';
import type { GitChange, PushPreviewDialogRequest, RepositoryStatus } from '@git4vsc/shared-types';
import { formatCommitTime, OperationActivity, OverlayScrollbar, PushFileTree } from '@git4vsc/ui';
import './commit.css';

interface RepositoryChoice {
  root: string;
  name: string;
  branch: string;
  changes: number;
}

interface CommitViewState {
  repositories: RepositoryChoice[];
  activeRoot: string | null;
  status: RepositoryStatus | null;
  selectedPaths: string[];
  message: string;
  loading: boolean;
  operation: string | null;
  activity: string | null;
  error: string | null;
  aiConfigured: boolean;
  aiGenerating: boolean;
  pushPreview: PushPreviewDialogRequest | null;
}

interface ChangeGroup {
  id: 'conflicts' | 'changes' | 'untracked';
  title: string;
  changes: GitChange[];
}

type ChangeTone = 'added' | 'modified' | 'deleted' | 'unversioned' | 'conflict';
type FileAction = 'commitFile' | 'rollbackFile' | 'deleteFile' | 'jumpToSource' | 'addToVcs' | 'addToIgnore';
const fileNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

interface FileMenuState {
  change: GitChange;
  x: number;
  y: number;
}

interface SelectionSummary {
  added: number;
  modified: number;
  deleted: number;
}

const initialState: CommitViewState = {
  repositories: [],
  activeRoot: null,
  status: null,
  selectedPaths: [],
  message: '',
  loading: true,
  operation: null,
  activity: null,
  error: null,
  aiConfigured: false,
  aiGenerating: false,
  pushPreview: null
};

export function CommitApp({ postMessage }: { postMessage(message: unknown): void }) {
  const [state, setState] = useState(initialState);
  const [message, setMessage] = useState('');
  const [fileMenu, setFileMenu] = useState<FileMenuState | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [messageHeight, setMessageHeight] = useState(136);
  const messageRef = useRef('');
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const changesRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const listener = (event: MessageEvent<{ type: string; state: CommitViewState }>) => {
      if (event.data.type !== 'commitSnapshot') return;
      setState(event.data.state);
      setActivePath(current => event.data.state.status?.changes.some(change => change.path === current) ? current : null);
      setMessage(event.data.state.message);
      messageRef.current = event.data.state.message;
    };
    window.addEventListener('message', listener);
    postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', listener);
  }, [postMessage]);

  useEffect(() => {
    if (!fileMenu) return;
    const close = () => setFileMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [fileMenu]);

  const groups = useMemo(() => changeGroups(state.status?.changes ?? []), [state.status]);
  const selectedPaths = useMemo(() => new Set(state.selectedPaths), [state.selectedPaths]);
  const selected = (change: GitChange) => selectedPaths.has(change.path);
  const selectedCount = selectedPaths.size;
  const selectionSummary = useMemo(() => selectedChangeSummary(state.status?.changes ?? [], selectedPaths), [state.status, selectedPaths]);
  const rollbackCount = (state.status?.changes ?? []).filter(change => selected(change) && !change.conflict && change.workingTree !== 'untracked').length;
  const conflictCount = groups.find(group => group.id === 'conflicts')?.changes.length ?? 0;
  const busy = state.loading || state.operation !== null || state.aiGenerating;
  const aiTitle = !state.aiConfigured
    ? 'Configure Base URL, API key and model in Git4VSC Settings → AI'
    : state.aiGenerating
      ? 'Stop generating commit message'
      : selectedCount === 0
        ? 'Select changed files to generate a commit message'
        : conflictCount > 0
          ? 'Resolve conflicts before generating a commit message'
          : 'Generate commit message with AI';

  function setSelected(changes: readonly GitChange[], value: boolean) {
    setState(previous => {
      const paths = new Set(previous.selectedPaths);
      for (const change of changes) {
        if (value) paths.add(change.path);
        else paths.delete(change.path);
      }
      return { ...previous, selectedPaths: [...paths] };
    });
    postMessage({ type: 'select', selected: value, paths: changes.map(change => change.path) });
  }

  function updateMessage(value: string) {
    setMessage(value);
    messageRef.current = value;
    postMessage({ type: 'message', message: value });
  }

  function commit() {
    postMessage({ type: 'commit', message: messageRef.current });
  }

  function commitAndPush() {
    postMessage({ type: 'commitAndPush', message: messageRef.current });
  }

  function runFileAction(action: FileAction, change: GitChange) {
    setFileMenu(null);
    if (action === 'commitFile') {
      setState(previous => ({ ...previous, selectedPaths: [change.path] }));
      postMessage({ type: 'replaceSelection', paths: [change.path] });
      requestAnimationFrame(() => messageInput.current?.focus());
      return;
    }
    postMessage({ type: action, path: change.path });
  }

  function resizeMessageArea(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = messageHeight;
    const move = (moveEvent: PointerEvent) => setMessageHeight(Math.max(102, Math.min(window.innerHeight * .72, startHeight + startY - moveEvent.clientY)));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  if (!state.repositories.length) {
    return <main className="commit-view commit-empty-state">
      <span className="commit-empty-icon">⎇</span>
      <strong>No Git repository</strong>
      <span>Open a folder containing a Git repository.</span>
    </main>;
  }

  if (state.pushPreview) return <PushPreviewMode preview={state.pushPreview} busy={busy} activity={state.activity} postMessage={postMessage} />;

  return <main className="commit-view commit-main-view">
    <OperationActivity label={state.activity} />
    <header className="commit-toolbar">
      {state.repositories.length > 1
        ? <select aria-label="Repository" value={state.activeRoot ?? ''} onChange={event => postMessage({ type: 'selectRepository', root: event.target.value })}>
          {state.repositories.map(repository => <option key={repository.root} value={repository.root}>{repository.name} · {repository.branch}</option>)}
        </select>
        : <div className="commit-repository" title={state.repositories[0]?.root}>
          <span className="commit-repository-name">{state.repositories[0]?.name}</span>
          <span className="commit-branch">{state.repositories[0]?.branch}</span>
        </div>}
      <button
        className="commit-toolbar-action"
        title="Rollback selected changes…"
        aria-label="Rollback selected changes"
        disabled={busy || rollbackCount === 0}
        onClick={() => postMessage({ type: 'rollback' })}
      >↶</button>
    </header>

    {state.error && <div className="commit-error">{state.error}</div>}

    <section ref={changesRef} className="commit-changes" aria-label="Changes">
      {groups.length === 0
        ? <div className="commit-no-changes">No changes</div>
        : groups.map(group => <ChangeGroupView key={group.id} group={group} busy={busy} selected={selected} activePath={activePath} setActivePath={setActivePath} setSelected={setSelected} postMessage={postMessage} openFileMenu={setFileMenu} />)}
    </section>
    <OverlayScrollbar targetRef={changesRef} />

    <footer className="commit-message-area" style={{ height: messageHeight }}>
      <div className="commit-message-resizer" title="Drag to resize Commit Message" onPointerDown={resizeMessageArea} />
      <SelectionSummaryView summary={selectionSummary} />
      <textarea
        id="git4vsc-commit-message"
        ref={messageInput}
        aria-label="Commit Message"
        value={message}
        disabled={busy || conflictCount > 0}
        placeholder={conflictCount ? 'Resolve conflicts before committing' : 'Enter commit message'}
        onChange={event => updateMessage(event.target.value)}
        onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && message.trim() && selectedCount > 0 && !busy && conflictCount === 0) {
            event.preventDefault();
            commit();
          }
        }}
      />
      <div className="commit-actions">
        <span className="ai-commit-action" title={aiTitle}>
          <button
            type="button"
            className={`ai-commit-button ${state.aiGenerating ? 'generating' : state.aiConfigured ? 'ready' : 'unconfigured'}`}
            aria-label={aiTitle}
            disabled={state.aiConfigured && !state.aiGenerating && (selectedCount === 0 || state.loading || state.operation !== null || conflictCount > 0)}
            onClick={() => {
              if (!state.aiConfigured) {
                postMessage({ type: 'openAiSettings' });
              } else if (state.aiGenerating) {
                setState(previous => ({ ...previous, aiGenerating: false }));
                postMessage({ type: 'cancelCommitMessage' });
              } else {
                setState(previous => ({ ...previous, aiGenerating: true }));
                postMessage({ type: 'generateCommitMessage' });
              }
            }}
          ><AiCommitIcon spinning={state.aiGenerating} /></button>
        </span>
        <button className="commit-primary-action" disabled={!message.trim() || selectedCount === 0 || busy || conflictCount > 0} onClick={commit}>
          {state.operation === 'commit' ? 'Committing…' : 'Commit'}
        </button>
        <button className="commit-and-push-action" disabled={!message.trim() || selectedCount === 0 || busy || conflictCount > 0} onClick={commitAndPush}>
          Commit and Push
        </button>
      </div>
    </footer>
    {fileMenu && <FileContextMenu menu={fileMenu} busy={busy} run={runFileAction} />}
  </main>;
}

function PushPreviewMode({ preview, busy, activity, postMessage }: {
  preview: PushPreviewDialogRequest;
  busy: boolean;
  activity: string | null;
  postMessage(message: unknown): void;
}) {
  const [selectedHash, setSelectedHash] = useState(preview.commits[0]?.commit.hash ?? null);
  const [groupByDirectory, setGroupByDirectory] = useState(true);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetBranch, setTargetBranch] = useState(preview.targetBranch);
  const targetInput = useRef<HTMLInputElement>(null);
  const commitsRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const selected = preview.commits.find(item => item.commit.hash === selectedHash) ?? preview.commits[0];
  const normalizedTarget = targetBranch.trim();
  const newTarget = normalizedTarget.length > 0 && !preview.existingTargetBranches.includes(normalizedTarget);
  const protectedTarget = branchMatches(normalizedTarget, preview.protectedBranches);

  useEffect(() => { if (editingTarget) targetInput.current?.select(); }, [editingTarget]);

  return <main className="commit-view commit-push-view">
    <OperationActivity label={activity} />
    <header className="commit-push-toolbar">
      <button type="button" aria-label="Back to Commit" title="Back to Commit" onClick={() => postMessage({ type: 'closePushPreview' })}>‹</button>
      <div>
        <strong>Push</strong>
        <span className="commit-push-route" title={`${preview.source} → ${preview.remote}:${normalizedTarget}`}>
          <span>{preview.source}</span><span>→</span><span>{preview.remote}:</span>
          {editingTarget
            ? <input ref={targetInput} aria-label="Target branch" value={targetBranch} onChange={event => setTargetBranch(event.target.value)} onBlur={() => setEditingTarget(false)} onKeyDown={event => {
              if (event.key === 'Enter') setEditingTarget(false);
              else if (event.key === 'Escape') { setTargetBranch(preview.targetBranch); setEditingTarget(false); }
            }} />
            : <button type="button" title="Edit target branch" onClick={() => setEditingTarget(true)}>{normalizedTarget || 'branch'}</button>}
          {newTarget && <em>NEW</em>}
        </span>
      </div>
      <small>{preview.commits.length}</small>
    </header>

    <section className="commit-push-commits" aria-label="Commits to push">
      <header><strong>Commits</strong><span>{preview.commits.length} to push</span></header>
      <div ref={commitsRef} className="commit-push-commit-list">
        {preview.commits.map(item => <button
          type="button"
          key={item.commit.hash}
          className={item.commit.hash === selected?.commit.hash ? 'selected' : ''}
          onClick={() => setSelectedHash(item.commit.hash)}
        >
          <span>{item.commit.subject}</span>
          <small>{item.commit.authorName} · {formatCommitTime(item.commit.authorTime)}</small>
        </button>)}
      </div>
      <OverlayScrollbar targetRef={commitsRef} />
    </section>

    <section className="commit-push-files" aria-label="Changes in selected commit">
      <header><strong>Changes</strong><span>{selected?.files.length ?? 0} files</span><details className="commit-push-options">
        <summary aria-label="View options" title="View options"><EyeIcon /></summary>
        <div><button type="button" onClick={() => setGroupByDirectory(value => !value)}><span>{groupByDirectory ? '✓' : ''}</span>Group by Directory</button></div>
      </details></header>
      <div ref={filesRef} className="commit-push-file-list">
        {selected ? <PushFileTree changes={selected.files} groupByDirectory={groupByDirectory} onOpen={change => postMessage({ type: 'openPushPreviewDiff', hash: selected.commit.hash, change })} /> : <div className="commit-push-empty">Select a commit</div>}
      </div>
      <OverlayScrollbar targetRef={filesRef} />
    </section>

    <footer className="commit-push-actions">
      <button type="button" disabled={busy} onClick={() => postMessage({ type: 'closePushPreview' })}>Cancel</button>
      <div className="commit-push-submit">
        <button type="button" className="primary" disabled={busy || !normalizedTarget} onClick={() => postMessage({ type: 'pushPreview', targetBranch: normalizedTarget })}>{busy ? 'Pushing…' : 'Push'}</button>
        <details className={busy || !normalizedTarget ? 'disabled' : ''}>
          <summary aria-label="Push options" title="Push options"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary>
          <div><button type="button" disabled={busy || !normalizedTarget || protectedTarget} title={protectedTarget ? `${normalizedTarget} is protected` : 'Push with --force-with-lease'} onClick={() => postMessage({ type: 'pushPreview', targetBranch: normalizedTarget, force: true })}>Force Push{protectedTarget ? ' (Protected)' : ''}</button></div>
        </details>
      </div>
    </footer>
  </main>;
}

function branchMatches(branch: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => {
    const value = pattern.trim();
    if (!value) return false;
    const escaped = value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
    return new RegExp(`^${escaped}$`).test(branch);
  });
}

function EyeIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.35-4 6.5-4 6.5 4 6.5 4-2.35 4-6.5 4-6.5-4-6.5-4Z" /><circle cx="8" cy="8" r="2" /></svg>;
}

function AiCommitIcon({ spinning }: { spinning: boolean }) {
  return spinning
    ? <svg className="stop" viewBox="0 0 16 16" aria-hidden="true"><rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1" /></svg>
    : <svg className="spark" viewBox="0 0 16 16" aria-hidden="true"><path d="M7.3 1.6c.3 2.55 1.48 3.74 4.03 4.04-2.55.3-3.73 1.48-4.03 4.03-.3-2.55-1.49-3.73-4.04-4.03C5.81 5.34 7 4.15 7.3 1.6Z" /><path d="M11.8 9c.16 1.37.8 2 2.17 2.17-1.37.16-2.01.8-2.17 2.17-.16-1.37-.8-2.01-2.17-2.17C11 11 11.64 10.37 11.8 9Z" /></svg>;
}

function SelectionSummaryView({ summary }: { summary: SelectionSummary }) {
  const entries = [
    { key: 'added', value: summary.added },
    { key: 'modified', value: summary.modified },
    { key: 'deleted', value: summary.deleted }
  ].filter(entry => entry.value > 0);
  return <div className="commit-selection-summary" aria-label="Selected change summary">
    {entries.length
      ? entries.map(entry => <span key={entry.key} className={`summary-${entry.key}`}>{entry.value} {entry.key}</span>)
      : <span className="summary-empty">No files selected</span>}
  </div>;
}

function ChangeGroupView({ group, busy, selected, activePath, setActivePath, setSelected, postMessage, openFileMenu }: {
  group: ChangeGroup;
  busy: boolean;
  selected(change: GitChange): boolean;
  activePath: string | null;
  setActivePath(path: string): void;
  setSelected(changes: readonly GitChange[], value: boolean): void;
  postMessage(message: unknown): void;
  openFileMenu(menu: FileMenuState): void;
}) {
  const conflict = group.id === 'conflicts';
  const selectedCount = group.changes.filter(selected).length;
  const allSelected = selectedCount === group.changes.length;
  return <details className="commit-change-group" open>
    <summary>
      {!conflict && <SelectionCheckbox
        ariaLabel={`${allSelected ? 'Exclude' : 'Include'} all ${group.title}`}
        checked={allSelected}
        indeterminate={selectedCount > 0 && !allSelected}
        disabled={busy}
        onClick={event => event.stopPropagation()}
        onChange={() => setSelected(group.changes, !allSelected)}
      />}
      <span>{group.title}</span>
      <small>{group.changes.length}</small>
    </summary>
    <div>
      {group.changes.map(change => <ChangeRow key={`${group.id}:${change.path}`} change={change} staged={selected(change)} active={activePath === change.path} conflict={conflict} busy={busy} setActivePath={setActivePath} setSelected={setSelected} postMessage={postMessage} openFileMenu={openFileMenu} />)}
    </div>
  </details>;
}

function ChangeRow({ change, staged, active, conflict, busy, setActivePath, setSelected, postMessage, openFileMenu }: {
  change: GitChange;
  staged: boolean;
  active: boolean;
  conflict: boolean;
  busy: boolean;
  setActivePath(path: string): void;
  setSelected(changes: readonly GitChange[], value: boolean): void;
  postMessage(message: unknown): void;
  openFileMenu(menu: FileMenuState): void;
}) {
  const slash = Math.max(change.path.lastIndexOf('/'), change.path.lastIndexOf('\\'));
  const folder = slash >= 0 ? change.path.slice(0, slash) : '';
  const name = slash >= 0 ? change.path.slice(slash + 1) : change.path;
  const side = change.workingTree !== null ? 'working' : 'staged';
  const tone = changeTone(change);
  return <div
    className={`commit-change-row${active ? ' selected' : ''}`}
    title={change.path}
    onContextMenu={event => {
      event.preventDefault();
      setActivePath(change.path);
      openFileMenu({ change, x: event.clientX, y: event.clientY });
    }}
  >
    {!conflict && <SelectionCheckbox
      ariaLabel={`${staged ? 'Exclude' : 'Include'} ${change.path}`}
      checked={staged}
      disabled={busy}
      onChange={() => setSelected([change], !staged)}
    />}
    <button className="commit-change-main" onClick={() => {
      setActivePath(change.path);
      postMessage({ type: conflict ? 'resolveConflict' : 'openChange', path: change.path, side });
    }}>
      <span className={`commit-change-name change-${tone}`}>{name}</span>
      {folder && <span className="commit-change-folder">{folder}</span>}
    </button>
    <button
      className="commit-row-action"
      title={conflict ? 'Open Merge Editor' : staged ? 'Exclude from Commit' : 'Include in Commit'}
      aria-label={conflict ? 'Open Merge Editor' : staged ? 'Exclude from Commit' : 'Include in Commit'}
      disabled={busy}
      onClick={() => conflict
        ? postMessage({ type: 'resolveConflict', path: change.path })
        : setSelected([change], !staged)}
    >{conflict ? '↔' : staged ? '−' : '+'}</button>
  </div>;
}

function FileContextMenu({ menu, busy, run }: {
  menu: FileMenuState;
  busy: boolean;
  run(action: FileAction, change: GitChange): void;
}) {
  const items = fileContextActions(menu.change);
  const left = Math.min(menu.x, window.innerWidth - 178);
  const top = Math.min(menu.y, window.innerHeight - items.length * 27 - 12);
  return <div className="commit-file-menu" role="menu" style={{ left: Math.max(4, left), top: Math.max(4, top) }} onMouseDown={event => event.stopPropagation()}>
    {items.map(item => <button
      key={item.action}
      role="menuitem"
      disabled={busy || !item.enabled}
      onClick={() => run(item.action, menu.change)}
    >{item.label}</button>)}
  </div>;
}

export function fileContextActions(change: GitChange): { action: FileAction; label: string; enabled: boolean }[] {
  const untracked = change.workingTree === 'untracked';
  const deleted = change.workingTree === 'deleted';
  return [
    { action: 'commitFile', label: 'Commit File…', enabled: !change.conflict },
    { action: 'rollbackFile', label: 'Rollback…', enabled: !change.conflict && !untracked },
    { action: 'deleteFile', label: 'Delete…', enabled: !deleted },
    { action: 'jumpToSource', label: 'Jump to Source', enabled: !deleted },
    { action: 'addToVcs', label: 'Add to VCS', enabled: untracked },
    { action: 'addToIgnore', label: 'Add to Ignore', enabled: untracked }
  ];
}

export function changeGroups(changes: readonly GitChange[]): ChangeGroup[] {
  const groups: ChangeGroup[] = [
    { id: 'conflicts', title: 'Merge Conflicts', changes: changes.filter(change => change.conflict).sort(compareIdeaFiles) },
    { id: 'changes', title: 'Changes', changes: changes.filter(change => !change.conflict && change.workingTree !== 'untracked').sort(compareIdeaFiles) },
    { id: 'untracked', title: 'Unversioned Files', changes: changes.filter(change => change.workingTree === 'untracked').sort(compareIdeaFiles) }
  ];
  return groups.filter(group => group.changes.length > 0);
}

export function compareIdeaFiles(left: GitChange, right: GitChange): number {
  const leftName = left.path.slice(Math.max(left.path.lastIndexOf('/'), left.path.lastIndexOf('\\')) + 1);
  const rightName = right.path.slice(Math.max(right.path.lastIndexOf('/'), right.path.lastIndexOf('\\')) + 1);
  return fileNameCollator.compare(leftName, rightName) || fileNameCollator.compare(left.path, right.path);
}

export function changeTone(change: GitChange): ChangeTone {
  if (change.conflict || change.index === 'unmerged' || change.workingTree === 'unmerged') return 'conflict';
  if (change.workingTree === 'untracked') return 'unversioned';
  if (change.index === 'deleted' || change.workingTree === 'deleted') return 'deleted';
  if (change.index === 'added' || change.workingTree === 'added') return 'added';
  return 'modified';
}

export function selectedChangeSummary(changes: readonly GitChange[], selectedPaths: ReadonlySet<string>): SelectionSummary {
  const summary: SelectionSummary = { added: 0, modified: 0, deleted: 0 };
  for (const change of changes) {
    if (!selectedPaths.has(change.path) || change.conflict) continue;
    const tone = changeTone(change);
    if (tone === 'added' || tone === 'unversioned') summary.added += 1;
    else if (tone === 'deleted') summary.deleted += 1;
    else summary.modified += 1;
  }
  return summary;
}

function SelectionCheckbox({ ariaLabel, checked, indeterminate = false, disabled, onClick, onChange }: {
  ariaLabel: string;
  checked: boolean;
  indeterminate?: boolean;
  disabled: boolean;
  onClick?: ((event: React.MouseEvent<HTMLInputElement>) => void) | undefined;
  onChange(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={input} type="checkbox" aria-label={ariaLabel} checked={checked} disabled={disabled} onClick={onClick} onChange={onChange} />;
}
