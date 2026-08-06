import { useEffect, useMemo, useRef, useState } from 'react';
import type { GitChange, LocalChangelist, PushPreviewDialogRequest, RepositoryStatus } from '@git4vsc/shared-types';
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
  changelists: LocalChangelist[];
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
  id: string;
  kind: 'conflicts' | 'changelist' | 'untracked';
  title: string;
  changes: GitChange[];
  changelist?: LocalChangelist;
}

type ChangeTone = 'added' | 'modified' | 'deleted' | 'unversioned' | 'conflict';
type FileAction = 'commitFile' | 'moveToChangelist' | 'rollbackFile' | 'deleteFile' | 'jumpToSource' | 'addToVcs' | 'addToIgnore';
const fileNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

interface FileMenuState {
  change: GitChange;
  changes: GitChange[];
  x: number;
  y: number;
}

interface ChangelistMenuState {
  changelist: LocalChangelist;
  x: number;
  y: number;
}

interface ManageChangelistsState {
  id: string;
}

interface DeleteChangelistState {
  id: string;
  targetId: string;
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
  changelists: [],
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
  const [rowSelection, setRowSelection] = useState<Set<string>>(new Set());
  const [messageHeight, setMessageHeight] = useState(136);
  const [manageChangelists, setManageChangelists] = useState<ManageChangelistsState | null>(null);
  const [deleteChangelist, setDeleteChangelist] = useState<DeleteChangelistState | null>(null);
  const [changelistMenu, setChangelistMenu] = useState<ChangelistMenuState | null>(null);
  const [movePaths, setMovePaths] = useState<string[] | null>(null);
  const messageRef = useRef('');
  const rowAnchor = useRef<string | null>(null);
  const activeRoot = useRef<string | null>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const changesRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const listener = (event: MessageEvent<{ type: string; state: CommitViewState }>) => {
      if (event.data.type !== 'commitSnapshot') return;
      setState(event.data.state);
      const repositoryChanged = activeRoot.current !== event.data.state.activeRoot;
      activeRoot.current = event.data.state.activeRoot;
      const paths = new Set(event.data.state.status?.changes.map(change => change.path) ?? []);
      setRowSelection(current => repositoryChanged ? new Set() : new Set([...current].filter(path => paths.has(path))));
      if (repositoryChanged || (rowAnchor.current && !paths.has(rowAnchor.current))) rowAnchor.current = null;
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

  const groups = useMemo(() => changeGroups(state.status?.changes ?? [], state.changelists), [state.status, state.changelists]);
  const visibleChanges = useMemo(() => groups.flatMap(group => group.changes), [groups]);
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
  const activeChangelist = state.changelists.find(changelist => changelist.active) ?? state.changelists[0];

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

  function requestChangelistDeletion(id: string) {
    const list = state.changelists.find(candidate => candidate.id === id);
    const targetId = state.changelists.find(candidate => candidate.id !== id)?.id;
    if (!list || !targetId) return;
    setChangelistMenu(null);
    setManageChangelists(null);
    if (!list.paths.length) postMessage({ type: 'deleteChangelist', id, targetId });
    else setDeleteChangelist({ id, targetId });
  }

  function selectRow(change: GitChange, event: React.MouseEvent) {
    const result = nextRowSelection(visibleChanges.map(candidate => candidate.path), rowSelection, change.path, rowAnchor.current, event.ctrlKey || event.metaKey, event.shiftKey);
    rowAnchor.current = result.anchor;
    setRowSelection(result.selected);
  }

  function openFileMenu(change: GitChange, event: React.MouseEvent) {
    event.preventDefault();
    const selected = rowSelection.has(change.path) ? rowSelection : new Set([change.path]);
    if (!rowSelection.has(change.path)) {
      rowAnchor.current = change.path;
      setRowSelection(selected);
    }
    setFileMenu({ change, changes: visibleChanges.filter(candidate => selected.has(candidate.path)), x: event.clientX, y: event.clientY });
  }

  function selectDraggedRow(change: GitChange) {
    if (rowSelection.has(change.path)) return;
    rowAnchor.current = change.path;
    setRowSelection(new Set([change.path]));
  }

  function runFileAction(action: FileAction, menu: FileMenuState) {
    setFileMenu(null);
    if (action === 'commitFile') {
      const paths = menu.changes.filter(change => !change.conflict).map(change => change.path);
      setState(previous => ({ ...previous, selectedPaths: paths }));
      postMessage({ type: 'replaceSelection', paths });
      requestAnimationFrame(() => messageInput.current?.focus());
      return;
    }
    if (action === 'moveToChangelist') {
      setMovePaths(menu.changes.filter(change => !change.conflict && change.workingTree !== 'untracked').map(change => change.path));
      return;
    }
    if (action === 'rollbackFile') {
      postMessage({ type: action, paths: menu.changes.filter(change => !change.conflict && change.workingTree !== 'untracked').map(change => change.path) });
      return;
    }
    if (action === 'addToVcs') {
      postMessage({ type: action, paths: menu.changes.filter(change => change.workingTree === 'untracked').map(change => change.path) });
      return;
    }
    postMessage({ type: action, path: menu.change.path });
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
      <button
        className="commit-toolbar-action changelist-toolbar-action"
        title="Manage Changelists"
        aria-label="Manage Changelists"
        disabled={busy}
        onClick={() => activeChangelist && setManageChangelists({ id: activeChangelist.id })}
      ><ChangelistIcon /></button>
    </header>

    {state.error && <div className="commit-error">{state.error}</div>}

    <section ref={changesRef} className="commit-changes" aria-label="Changes">
      {groups.length === 0
        ? <div className="commit-no-changes">No changes</div>
        : groups.map(group => <ChangeGroupView key={group.id} group={group} busy={busy} selected={selected} rowSelection={rowSelection} visibleChanges={visibleChanges} selectRow={selectRow} selectDraggedRow={selectDraggedRow} setSelected={setSelected} postMessage={postMessage} openFileMenu={openFileMenu} openChangelistMenu={setChangelistMenu} openChangelists={id => setManageChangelists({ id })} />)}
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
    {changelistMenu && <ChangelistContextMenu
      menu={changelistMenu}
      listCount={state.changelists.length}
      close={() => setChangelistMenu(null)}
      edit={() => { setManageChangelists({ id: changelistMenu.changelist.id }); setChangelistMenu(null); }}
      remove={() => requestChangelistDeletion(changelistMenu.changelist.id)}
      setActive={() => { postMessage({ type: 'setActiveChangelist', id: changelistMenu.changelist.id }); setChangelistMenu(null); }}
    />}
    {manageChangelists && <ManageChangelistsDialog
      changelists={state.changelists}
      changes={state.status?.changes ?? []}
      selectedPaths={state.selectedPaths}
      initialId={manageChangelists.id}
      postMessage={postMessage}
      close={() => setManageChangelists(null)}
      requestDelete={requestChangelistDeletion}
    />}
    {deleteChangelist && <DeleteChangelistDialog
      changelists={state.changelists}
      value={deleteChangelist}
      postMessage={postMessage}
      close={() => setDeleteChangelist(null)}
    />}
    {movePaths && <MoveToChangelistDialog
      changelists={state.changelists}
      paths={movePaths}
      postMessage={postMessage}
      close={() => setMovePaths(null)}
    />}
  </main>;
}

function ManageChangelistsDialog({ changelists, changes, selectedPaths, initialId, postMessage, close, requestDelete }: {
  changelists: LocalChangelist[];
  changes: readonly GitChange[];
  selectedPaths: readonly string[];
  initialId: string;
  postMessage(message: unknown): void;
  close(): void;
  requestDelete(id: string): void;
}) {
  const initialSelected = changelists.find(list => list.id === initialId) ?? changelists.find(list => list.active) ?? changelists[0];
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [makeActive, setMakeActive] = useState(true);
  const [moveSelected, setMoveSelected] = useState(false);
  const selected = changelists.find(list => list.id === selectedId) ?? changelists[0];

  useEffect(() => {
    if (creating || !selected) return;
    setName(selected.name);
    setDescription(selected.description);
  }, [creating, selected?.id, selected?.name, selected?.description]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (creating) setCreating(false);
      else close();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [close, creating]);

  const currentPaths = new Set(changes.map(change => change.path));
  const count = (list: LocalChangelist) => list.paths.filter(path => currentPaths.has(path)).length;
  const otherLists = changelists.filter(list => list.id !== selected?.id);
  const duplicateName = changelists.some(list => (creating || list.id !== selected?.id) && list.name.localeCompare(name.trim(), undefined, { sensitivity: 'accent' }) === 0);
  const unchanged = !creating && selected?.name === name.trim() && selected.description === description.trim();

  function choose(id: string) {
    const next = changelists.find(list => list.id === id);
    setCreating(false);
    if (next) {
      setName(next.name);
      setDescription(next.description);
    }
    setSelectedId(id);
  }

  function startCreating() {
    setCreating(true);
    setName('');
    setDescription('');
    setMakeActive(true);
    setMoveSelected(false);
  }

  function save() {
    if (!name.trim()) return;
    if (creating) {
      postMessage({ type: 'createChangelist', name, description, active: makeActive, paths: moveSelected ? selectedPaths : [] });
      close();
    } else if (selected) {
      postMessage({ type: 'updateChangelist', id: selected.id, name, description });
    }
  }

  return <div className="commit-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="changelist-dialog" role="dialog" aria-modal="true" aria-label="Changelists">
      <header><strong>Changelists</strong><button type="button" aria-label="Close" onClick={close}>×</button></header>
      <div className="changelist-dialog-body">
        <aside>
          <div className="changelist-list">
            {changelists.map(list => <button type="button" key={list.id} className={!creating && selected?.id === list.id ? 'selected' : ''} onClick={() => choose(list.id)}>
              <span className={`changelist-active-dot${list.active ? ' active' : ''}`} />
              <span>{list.name}</span>
              <small>{count(list)}</small>
            </button>)}
          </div>
          <button type="button" className="changelist-new" onClick={startCreating}>＋ New Changelist</button>
        </aside>
        <div className="changelist-editor">
          <label>Name<input autoFocus={creating} value={name} onChange={event => setName(event.target.value)} /></label>
          {duplicateName && <span className="changelist-validation">A changelist with this name already exists.</span>}
          <label>Description<textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} /></label>
          {creating && <div className="changelist-options">
            <label><input type="checkbox" checked={makeActive} onChange={event => setMakeActive(event.target.checked)} /> Set active</label>
            <label><input type="checkbox" disabled={!selectedPaths.length} checked={moveSelected && selectedPaths.length > 0} onChange={event => setMoveSelected(event.target.checked)} /> Move included changes ({selectedPaths.length})</label>
          </div>}
          {!creating && selected && <div className="changelist-meta">
            <span>{count(selected)} changed · {selected.paths.length} assigned</span>
            {selected.active
              ? <strong>Active</strong>
              : <button type="button" onClick={() => postMessage({ type: 'setActiveChangelist', id: selected.id })}>Set Active</button>}
          </div>}
        </div>
      </div>
      <footer>
        {!creating && <button type="button" disabled={!selected || !otherLists.length} onClick={() => selected && requestDelete(selected.id)}>{selected?.paths.length ? 'Delete…' : 'Delete'}</button>}
        <span />
        <button type="button" onClick={close}>Close</button>
        <button type="button" className="primary" disabled={!name.trim() || duplicateName || unchanged} onClick={save}>{creating ? 'Create' : 'Save'}</button>
      </footer>
    </section>
  </div>;
}

function DeleteChangelistDialog({ changelists, value, postMessage, close }: {
  changelists: LocalChangelist[];
  value: DeleteChangelistState;
  postMessage(message: unknown): void;
  close(): void;
}) {
  const selected = changelists.find(list => list.id === value.id);
  const targets = changelists.filter(list => list.id !== value.id);
  const [targetId, setTargetId] = useState(targets.some(list => list.id === value.targetId) ? value.targetId : targets[0]?.id ?? '');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [close]);

  if (!selected || !targets.length) return null;
  const assigned = selected.paths.length;
  return <div className="commit-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="changelist-dialog delete-changelist-dialog" role="alertdialog" aria-modal="true" aria-label={`Delete ${selected.name}`}>
      <header><strong>Delete Changelist</strong><button type="button" aria-label="Close" onClick={close}>×</button></header>
      <div className="delete-changelist-body">
        <strong>Delete “{selected.name}”?</strong>
        <span>{assigned} assigned file{assigned === 1 ? '' : 's'} will be moved to:</span>
        <select autoFocus value={targetId} onChange={event => setTargetId(event.target.value)}>{targets.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select>
      </div>
      <footer><span /><button type="button" onClick={close}>Cancel</button><button type="button" className="danger" disabled={!targetId} onClick={() => { postMessage({ type: 'deleteChangelist', id: selected.id, targetId }); close(); }}>Delete</button></footer>
    </section>
  </div>;
}

function MoveToChangelistDialog({ changelists, paths, postMessage, close }: {
  changelists: LocalChangelist[];
  paths: readonly string[];
  postMessage(message: unknown): void;
  close(): void;
}) {
  const choices = moveTargetChangelists(changelists, paths);
  const directCreate = choices.length === 0;
  const [creating, setCreating] = useState(directCreate);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [makeActive, setMakeActive] = useState(false);
  const duplicateName = changelists.some(list => list.name.localeCompare(name.trim(), undefined, { sensitivity: 'accent' }) === 0);

  useEffect(() => {
    const backOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (creating && !directCreate) setCreating(false);
      else close();
    };
    window.addEventListener('keydown', backOnEscape);
    return () => window.removeEventListener('keydown', backOnEscape);
  }, [close, creating, directCreate]);

  return <div className="commit-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="changelist-dialog move-dialog" role="dialog" aria-modal="true" aria-label="Move to Another Changelist">
      <header><strong>Move {paths.length} change{paths.length === 1 ? '' : 's'} to</strong><button type="button" aria-label="Close" onClick={close}>×</button></header>
      {creating
        ? <div className="move-changelist-new">
          <p className="move-changelist-count">{paths.length} selected file{paths.length === 1 ? '' : 's'} will be moved to the new changelist.</p>
          <label>Name<input autoFocus value={name} onChange={event => setName(event.target.value)} /></label>
          {duplicateName && <span className="changelist-validation">A changelist with this name already exists.</span>}
          <label>Description<input value={description} onChange={event => setDescription(event.target.value)} /></label>
          <label><input type="checkbox" checked={makeActive} onChange={event => setMakeActive(event.target.checked)} /> Set active</label>
          <div><button type="button" onClick={() => directCreate ? close() : setCreating(false)}>{directCreate ? 'Cancel' : 'Back'}</button><button type="button" className="primary" disabled={!name.trim() || duplicateName} onClick={() => { postMessage({ type: 'createChangelist', name, description, active: makeActive, paths }); close(); }}>Create and Move</button></div>
        </div>
        : <div className="move-changelist-list">
          {choices.map(list => <button type="button" key={list.id} onClick={() => { postMessage({ type: 'moveToChangelist', id: list.id, paths }); close(); }}>
            <span className={`changelist-active-dot${list.active ? ' active' : ''}`} /><span>{list.name}</span>{list.active && <small>Active</small>}
          </button>)}
          <button type="button" onClick={() => setCreating(true)}>＋ New Changelist…</button>
        </div>}
    </section>
  </div>;
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

function ChangelistIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h2m2 0h7m-11 4h2m2 0h7m-11 4h2m2 0h7" /><path d="m2.2 3.4.7.7 1.3-1.5M2.2 7.4l.7.7 1.3-1.5M2.2 11.4l.7.7 1.3-1.5" /></svg>;
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

function ChangeGroupView({ group, busy, selected, rowSelection, visibleChanges, selectRow, selectDraggedRow, setSelected, postMessage, openFileMenu, openChangelistMenu, openChangelists }: {
  group: ChangeGroup;
  busy: boolean;
  selected(change: GitChange): boolean;
  rowSelection: ReadonlySet<string>;
  visibleChanges: readonly GitChange[];
  selectRow(change: GitChange, event: React.MouseEvent): void;
  selectDraggedRow(change: GitChange): void;
  setSelected(changes: readonly GitChange[], value: boolean): void;
  postMessage(message: unknown): void;
  openFileMenu(change: GitChange, event: React.MouseEvent): void;
  openChangelistMenu(menu: ChangelistMenuState): void;
  openChangelists(id: string): void;
}) {
  const conflict = group.kind === 'conflicts';
  const selectedCount = group.changes.filter(selected).length;
  const allSelected = group.changes.length > 0 && selectedCount === group.changes.length;
  return <details
    className="commit-change-group"
    open
    onDragOver={event => { if (group.changelist) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
    onDrop={event => {
      if (!group.changelist) return;
      event.preventDefault();
      const paths = readDraggedPaths(event.dataTransfer);
      if (paths.length) postMessage({ type: 'moveToChangelist', id: group.changelist.id, paths });
    }}
  >
    <summary onContextMenu={event => {
      if (!group.changelist) return;
      event.preventDefault();
      openChangelistMenu({ changelist: group.changelist, x: event.clientX, y: event.clientY });
    }}>
      {!conflict && <SelectionCheckbox
        ariaLabel={`${allSelected ? 'Exclude' : 'Include'} all ${group.title}`}
        checked={allSelected}
        indeterminate={selectedCount > 0 && !allSelected}
        disabled={busy || group.changes.length === 0}
        onClick={event => event.stopPropagation()}
        onChange={() => setSelected(group.changes, !allSelected)}
      />}
      <span>{group.title}</span>
      {group.changelist?.active && <span className="changelist-active-label">Active</span>}
      <small>{group.changes.length}</small>
      {group.changelist && <button type="button" className="changelist-group-action" aria-label={`Manage ${group.title}`} title="Manage Changelist" onClick={event => { event.preventDefault(); event.stopPropagation(); openChangelists(group.changelist!.id); }}>⋯</button>}
    </summary>
    <div>
      {group.changes.map(change => <ChangeRow
        key={`${group.id}:${change.path}`}
        change={change}
        staged={selected(change)}
        rowSelected={rowSelection.has(change.path)}
        dragPaths={draggedChangePaths(change, rowSelection, visibleChanges)}
        conflict={conflict}
        busy={busy}
        selectRow={selectRow}
        selectDraggedRow={selectDraggedRow}
        setSelected={setSelected}
        postMessage={postMessage}
        openFileMenu={openFileMenu}
      />)}
      {!group.changes.length && <div className="changelist-group-empty">No files</div>}
    </div>
  </details>;
}

function ChangeRow({ change, staged, rowSelected, dragPaths, conflict, busy, selectRow, selectDraggedRow, setSelected, postMessage, openFileMenu }: {
  change: GitChange;
  staged: boolean;
  rowSelected: boolean;
  dragPaths: readonly string[];
  conflict: boolean;
  busy: boolean;
  selectRow(change: GitChange, event: React.MouseEvent): void;
  selectDraggedRow(change: GitChange): void;
  setSelected(changes: readonly GitChange[], value: boolean): void;
  postMessage(message: unknown): void;
  openFileMenu(change: GitChange, event: React.MouseEvent): void;
}) {
  const slash = Math.max(change.path.lastIndexOf('/'), change.path.lastIndexOf('\\'));
  const folder = slash >= 0 ? change.path.slice(0, slash) : '';
  const name = slash >= 0 ? change.path.slice(slash + 1) : change.path;
  const side = change.workingTree !== null ? 'working' : 'staged';
  const tone = changeTone(change);
  return <div
    className={`commit-change-row${rowSelected ? ' selected' : ''}`}
    title={change.path}
    draggable={!busy && !conflict && change.workingTree !== 'untracked'}
    onDragStart={event => {
      selectDraggedRow(change);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-git4vsc-changes', JSON.stringify(dragPaths));
      event.dataTransfer.setData('text/plain', dragPaths.join('\n'));
    }}
    onContextMenu={event => {
      openFileMenu(change, event);
    }}
  >
    {!conflict && <SelectionCheckbox
      ariaLabel={`${staged ? 'Exclude' : 'Include'} ${change.path}`}
      checked={staged}
      disabled={busy}
      onChange={() => setSelected([change], !staged)}
    />}
    <button className="commit-change-main" onClick={event => selectRow(change, event)} onDoubleClick={() => {
      postMessage({ type: conflict ? 'resolveConflict' : 'openChange', path: change.path, side });
    }} onKeyDown={event => {
      if (event.key === 'Enter') postMessage({ type: conflict ? 'resolveConflict' : 'openChange', path: change.path, side });
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

function readDraggedPaths(data: DataTransfer): string[] {
  try {
    const value = JSON.parse(data.getData('application/x-git4vsc-changes')) as unknown;
    return Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string') : [];
  } catch {
    return [];
  }
}

function ChangelistContextMenu({ menu, listCount, close, edit, remove, setActive }: {
  menu: ChangelistMenuState;
  listCount: number;
  close(): void;
  edit(): void;
  remove(): void;
  setActive(): void;
}) {
  useEffect(() => {
    const closeMenu = () => close();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [close]);

  const width = Math.min(220, window.innerWidth - 8);
  const left = Math.min(menu.x, window.innerWidth - width - 4);
  const top = Math.min(menu.y, window.innerHeight - 92);
  return <div className="commit-file-menu changelist-context-menu" role="menu" style={{ left: Math.max(4, left), top: Math.max(4, top) }} onMouseDown={event => event.stopPropagation()}>
    <button type="button" role="menuitem" onClick={edit}>Edit Changelist…</button>
    {!menu.changelist.active && <button type="button" role="menuitem" onClick={setActive}>Set Active Changelist</button>}
    <button type="button" role="menuitem" disabled={listCount < 2} onClick={remove}>{menu.changelist.paths.length ? 'Delete Changelist…' : 'Delete Changelist'}</button>
  </div>;
}

function FileContextMenu({ menu, busy, run }: {
  menu: FileMenuState;
  busy: boolean;
  run(action: FileAction, menu: FileMenuState): void;
}) {
  const items = fileContextActions(menu.change, menu.changes);
  const left = Math.min(menu.x, window.innerWidth - Math.min(270, window.innerWidth - 8) - 4);
  const top = Math.min(menu.y, window.innerHeight - items.length * 27 - 12);
  return <div className="commit-file-menu" role="menu" style={{ left: Math.max(4, left), top: Math.max(4, top) }} onMouseDown={event => event.stopPropagation()}>
    {items.map(item => <button
      key={item.action}
      role="menuitem"
      disabled={busy || !item.enabled}
      onClick={() => run(item.action, menu)}
    >{item.label}</button>)}
  </div>;
}

export function fileContextActions(change: GitChange, selection: readonly GitChange[] = [change]): { action: FileAction; label: string; enabled: boolean }[] {
  const untracked = change.workingTree === 'untracked';
  const deleted = change.workingTree === 'deleted';
  const commitCount = selection.filter(candidate => !candidate.conflict).length;
  const moveCount = selection.filter(candidate => !candidate.conflict && candidate.workingTree !== 'untracked').length;
  const rollbackCount = selection.filter(candidate => !candidate.conflict && candidate.workingTree !== 'untracked').length;
  const addCount = selection.filter(candidate => candidate.workingTree === 'untracked').length;
  return [
    { action: 'commitFile', label: commitCount > 1 ? 'Commit Files…' : 'Commit File…', enabled: commitCount > 0 },
    { action: 'moveToChangelist', label: 'Move to Another Changelist…', enabled: moveCount > 0 },
    { action: 'rollbackFile', label: 'Rollback…', enabled: rollbackCount > 0 },
    { action: 'deleteFile', label: 'Delete…', enabled: !deleted },
    { action: 'jumpToSource', label: 'Jump to Source', enabled: !deleted },
    { action: 'addToVcs', label: 'Add to VCS', enabled: addCount > 0 },
    { action: 'addToIgnore', label: 'Add to Ignore', enabled: untracked }
  ];
}

export function changeGroups(changes: readonly GitChange[], changelists: readonly LocalChangelist[] = []): ChangeGroup[] {
  const tracked = changes.filter(change => !change.conflict && change.workingTree !== 'untracked');
  const listGroups: ChangeGroup[] = changelists.length
    ? changelists.map(changelist => ({
      id: `changelist:${changelist.id}`,
      kind: 'changelist',
      title: changelist.name,
      changelist,
      changes: tracked.filter(change => changelist.paths.includes(change.path)).sort(compareIdeaFiles)
    }))
    : [{ id: 'changes', kind: 'changelist', title: 'Changes', changes: tracked.sort(compareIdeaFiles) }];
  const groups: ChangeGroup[] = [
    { id: 'conflicts', kind: 'conflicts', title: 'Merge Conflicts', changes: changes.filter(change => change.conflict).sort(compareIdeaFiles) },
    ...listGroups,
    { id: 'untracked', kind: 'untracked', title: 'Unversioned Files', changes: changes.filter(change => change.workingTree === 'untracked').sort(compareIdeaFiles) }
  ];
  return groups.filter(group => group.kind === 'changelist' || group.changes.length > 0);
}

export function draggedChangePaths(change: GitChange, rowSelection: ReadonlySet<string>, visibleChanges: readonly GitChange[]): string[] {
  const changes = rowSelection.has(change.path) ? visibleChanges.filter(candidate => rowSelection.has(candidate.path)) : [change];
  return changes.filter(candidate => !candidate.conflict && candidate.workingTree !== 'untracked').map(candidate => candidate.path);
}

export function moveTargetChangelists(changelists: readonly LocalChangelist[], paths: readonly string[]): LocalChangelist[] {
  const owners = new Set(paths.flatMap(path => changelists.filter(list => list.paths.includes(path)).map(list => list.id)));
  return owners.size === 1 ? changelists.filter(list => !owners.has(list.id)) : [...changelists];
}

export function nextRowSelection(
  order: readonly string[],
  current: ReadonlySet<string>,
  clicked: string,
  anchor: string | null,
  additive: boolean,
  range: boolean
): { selected: Set<string>; anchor: string } {
  if (range && anchor && order.includes(anchor)) {
    const from = order.indexOf(anchor);
    const to = order.indexOf(clicked);
    const selected = additive ? new Set(current) : new Set<string>();
    for (const path of order.slice(Math.min(from, to), Math.max(from, to) + 1)) selected.add(path);
    return { selected, anchor };
  }
  if (additive) {
    const selected = new Set(current);
    if (selected.has(clicked)) selected.delete(clicked);
    else selected.add(clicked);
    return { selected, anchor: clicked };
  }
  return { selected: new Set([clicked]), anchor: clicked };
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
