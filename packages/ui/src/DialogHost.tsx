import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { CommitFileChange, DialogListItem, DialogListSelection, PathTreeDialogRequest, PathTreeEntry, WebviewDialogRequest } from '@git4vsc/shared-types';
import { formatCommitTime } from './commit-date.js';
import { OverlayScrollbar } from './OverlayScrollbar.js';

export function DialogHost({ dialog, onResolve, onExpandPath }: {
  dialog: WebviewDialogRequest | null;
  onResolve(value: string | string[] | DialogListSelection | null): void;
  onExpandPath?(dialogId: number, path: string): void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const searchable = dialog?.kind === 'list' && dialog.searchable !== false;

  useEffect(() => {
    if (!dialog) {
      returnFocus.current?.focus();
      return;
    }
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setInputValue(dialog.kind === 'list' ? dialog.input?.value ?? '' : '');
    setSelectedId(dialog?.kind === 'list' ? dialog.items.find(item => !item.separator)?.id ?? null : null);
    setSelectedHash(dialog?.kind === 'push-preview' ? dialog.commits[0]?.commit.hash ?? null : null);
    requestAnimationFrame(() => (dialog.kind === 'list' && dialog.input ? input.current : dialog.kind === 'list' && dialog.searchable !== false ? search.current : frame.current)?.focus());
  }, [dialog]);

  const visibleItems = useMemo(() => dialog?.kind === 'list' ? filterDialogItems(dialog.items, query) : [], [dialog, query]);
  useEffect(() => {
    if (dialog?.kind !== 'list' || visibleItems.some(item => !item.separator && item.id === selectedId)) return;
    setSelectedId(visibleItems.find(item => !item.separator)?.id ?? null);
  }, [dialog, selectedId, visibleItems]);
  if (!dialog) return null;

  const selectable = visibleItems.filter(item => !item.separator);
  const compact = dialog.kind === 'list' && !searchable;
  const inputEnabled = dialog.kind === 'list' && Boolean(dialog.input) && (!dialog.input?.enabledFor || Boolean(selectedId && dialog.input.enabledFor.includes(selectedId)));
  const inputRequired = dialog.kind === 'list' && Boolean(dialog.input?.requiredFor && selectedId && dialog.input.requiredFor.includes(selectedId));
  const listValue = (): string | DialogListSelection | null => dialog.kind !== 'list' || !selectedId
    ? null
    : dialog.input ? { id: selectedId, input: inputValue.trim() } : selectedId;
  const acceptDisabled = !selectedId || inputRequired && !inputValue.trim();
  const frameStyle = dialog.kind === 'list'
    ? { '--dialog-list-height': `${compact ? Math.min(12, Math.max(1, dialog.items.length)) * 25 : dialogListHeight(dialog.items)}px` } as CSSProperties
    : undefined;
  const move = (delta: number) => {
    if (!selectable.length) return;
    const current = selectable.findIndex(item => item.id === selectedId);
    setSelectedId(selectable[(current + delta + selectable.length) % selectable.length]!.id);
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onResolve(null); }
    else if (event.key === 'ArrowDown' && dialog.kind === 'list') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp' && dialog.kind === 'list') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter' && dialog.kind === 'list' && !acceptDisabled) { event.preventDefault(); onResolve(listValue()); }
    else if (event.key === 'Tab') trapFocus(event, frame.current);
  };

  return <div className="dialog-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onResolve(null); }}>
    <div ref={frame} className={`dialog-frame ${dialog.kind === 'list' ? 'dialog-list-frame' : `dialog-${dialog.kind}`}${compact ? ' dialog-compact-list' : ''}${dialog.kind === 'list' && dialog.input ? ' dialog-with-input' : ''}`} style={frameStyle} role="dialog" aria-modal="true" aria-labelledby={`dialog-title-${dialog.id}`} tabIndex={-1} onKeyDown={keydown}>
      <header className="dialog-header"><strong id={`dialog-title-${dialog.id}`}>{dialog.title}</strong><button type="button" aria-label="Close" onClick={() => onResolve(null)}>×</button></header>
      {dialog.kind === 'list'
        ? <>
          {searchable && <div className="dialog-search"><span className="sidebar-search-icon" /><input ref={search} value={query} aria-label="Filter options" placeholder={dialog.placeholder ?? 'Search'} onChange={event => setQuery(event.target.value)} /></div>}
          {dialog.input && <label className="dialog-list-input"><span>{dialog.input.label}</span><input ref={input} value={inputValue} disabled={!inputEnabled} placeholder={inputEnabled ? dialog.input.placeholder : 'Not used for this option'} onChange={event => setInputValue(event.target.value)} /></label>}
          <div className="dialog-list-body">
            <div ref={list} className="dialog-list" role="listbox">
              {visibleItems.map(item => item.separator
                ? <div key={item.id} className="dialog-list-separator">{item.label}</div>
                : <button key={item.id} type="button" role="option" aria-selected={item.id === selectedId} className={item.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(item.id)} onDoubleClick={() => { if (!(dialog.input?.requiredFor?.includes(item.id) && !inputValue.trim())) onResolve(dialog.input ? { id: item.id, input: inputValue.trim() } : item.id); }}>
                  <span className="dialog-item-label">{item.label}</span>{item.description && <span className="dialog-item-description">{item.description}</span>}{item.detail && <small>{item.detail}</small>}
                </button>)}
              {!selectable.length && <div className="dialog-empty">No matching items</div>}
            </div>
            <OverlayScrollbar targetRef={list} />
          </div>
          <footer className="dialog-footer"><button type="button" onClick={() => onResolve(null)}>Cancel</button><button type="button" className="dialog-primary" disabled={acceptDisabled} onClick={() => onResolve(listValue())}>{dialog.acceptLabel ?? 'Select'}</button></footer>
        </>
        : dialog.kind === 'path-tree'
          ? <PathTreeDialog dialog={dialog} onExpandPath={onExpandPath} onCancel={() => onResolve(null)} onAccept={paths => onResolve(paths)} />
          : <PushPreview dialog={dialog} selectedHash={selectedHash} onSelect={setSelectedHash} onCancel={() => onResolve(null)} onPush={() => onResolve('push')} />}
    </div>
  </div>;
}

function dialogListHeight(items: DialogListItem[]): number {
  return Math.max(27, items.slice(0, 12).reduce((height, item) => height + (item.separator ? 23 : item.detail ? 39 : 27), 0));
}

function PathTreeDialog({ dialog, onExpandPath, onCancel, onAccept }: {
  dialog: PathTreeDialogRequest;
  onExpandPath?: ((dialogId: number, path: string) => void) | undefined;
  onCancel(): void;
  onAccept(paths: string[]): void;
}) {
  const [selected, setSelected] = useState(() => new Set(dialog.selectedPaths));
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [loading, setLoading] = useState(() => new Set<string>());

  useEffect(() => {
    setLoading(current => {
      const next = new Set([...current].filter(path => findPathEntry(dialog.entries, path)?.children === undefined));
      return next.size === current.size ? current : next;
    });
  }, [dialog.entries]);

  const toggleSelected = (path: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const toggleExpanded = (entry: PathTreeEntry) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else {
        next.add(entry.path);
        if (entry.children === undefined) {
          setLoading(paths => new Set(paths).add(entry.path));
          onExpandPath?.(dialog.id, entry.path);
        }
      }
      return next;
    });
  };

  return <>
    <div className="path-tree" role="tree" aria-label="Repository paths">
      {dialog.entries.map(entry => <PathTreeRow key={entry.path} entry={entry} depth={0} selected={selected} expanded={expanded} loading={loading} onToggleSelected={toggleSelected} onToggleExpanded={toggleExpanded} />)}
      {!dialog.entries.length && <div className="dialog-empty">No files or folders</div>}
    </div>
    <footer className="dialog-footer"><span className="path-selection-count">{selected.size ? `${selected.size} selected` : 'Select files or folders'}</span><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="dialog-primary" disabled={!selected.size} onClick={() => onAccept([...selected])}>OK</button></footer>
  </>;
}

function PathTreeRow({ entry, depth, selected, expanded, loading, onToggleSelected, onToggleExpanded }: {
  entry: PathTreeEntry;
  depth: number;
  selected: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  loading: ReadonlySet<string>;
  onToggleSelected(path: string): void;
  onToggleExpanded(entry: PathTreeEntry): void;
}) {
  const open = expanded.has(entry.path);
  return <>
    <div className="path-tree-row" role="treeitem" aria-expanded={entry.directory ? open : undefined} style={{ paddingLeft: 7 + depth * 18 }} title={entry.path}>
      {entry.directory
        ? <button type="button" className={`path-tree-chevron${open ? ' open' : ''}`} aria-label={`${open ? 'Collapse' : 'Expand'} ${entry.name}`} onClick={() => onToggleExpanded(entry)}><PathChevronIcon /></button>
        : <span className="path-tree-chevron" />}
      <label><input type="checkbox" checked={selected.has(entry.path)} onChange={() => onToggleSelected(entry.path)} />{entry.directory && <span className="path-folder-icon" />}<span>{entry.name}</span></label>
      {loading.has(entry.path) && <span className="path-tree-loading">Loading…</span>}
    </div>
    {entry.directory && open && <div role="group">
      {entry.children?.map(child => <PathTreeRow key={child.path} entry={child} depth={depth + 1} selected={selected} expanded={expanded} loading={loading} onToggleSelected={onToggleSelected} onToggleExpanded={onToggleExpanded} />)}
      {entry.children?.length === 0 && <div className="path-tree-empty" style={{ paddingLeft: 43 + depth * 18 }}>Empty folder</div>}
    </div>}
  </>;
}

function findPathEntry(entries: readonly PathTreeEntry[], path: string): PathTreeEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    const found = entry.children && findPathEntry(entry.children, path);
    if (found) return found;
  }
  return undefined;
}

export function updatePathTreeEntries(entries: readonly PathTreeEntry[], path: string, children: PathTreeEntry[]): PathTreeEntry[] {
  return entries.map(entry => entry.path === path
    ? { ...entry, children }
    : entry.children ? { ...entry, children: updatePathTreeEntries(entry.children, path, children) } : entry);
}

function PathChevronIcon() {
  return <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 2.5 3.5 3.5L4 9.5" /></svg>;
}

export function filterDialogItems(items: readonly DialogListItem[], query: string): DialogListItem[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...items];
  const result: DialogListItem[] = [];
  let separator: DialogListItem | undefined;
  let group: DialogListItem[] = [];
  const flush = () => {
    if (!group.length) return;
    if (separator) result.push(separator);
    result.push(...group);
    group = [];
  };
  for (const item of items) {
    if (item.separator) { flush(); separator = item; continue; }
    const text = `${item.label ?? ''} ${item.description ?? ''} ${item.detail ?? ''}`.toLocaleLowerCase();
    if (text.includes(needle)) group.push(item);
  }
  flush();
  return result;
}

function PushPreview({ dialog, selectedHash, onSelect, onCancel, onPush }: {
  dialog: Extract<WebviewDialogRequest, { kind: 'push-preview' }>;
  selectedHash: string | null;
  onSelect(hash: string): void;
  onCancel(): void;
  onPush(): void;
}) {
  const selected = dialog.commits.find(item => item.commit.hash === selectedHash) ?? dialog.commits[0];
  return <>
    <div className="push-preview-route"><span>{dialog.source}</span><span>→</span><span>{dialog.target}</span><small>{dialog.commits.length} commit{dialog.commits.length === 1 ? '' : 's'}</small></div>
    <div className="push-preview-body">
      <section className="push-commits" aria-label="Commits to push">
        {dialog.commits.map(item => <button type="button" key={item.commit.hash} className={item.commit.hash === selected?.commit.hash ? 'selected' : ''} onClick={() => onSelect(item.commit.hash)}>
          <span>{item.commit.subject}</span><small>{item.commit.authorName} · {formatCommitTime(item.commit.authorTime)}</small>
        </button>)}
      </section>
      <section className="push-files" aria-label="Changed files">
        <header><strong>Changes</strong><span>{selected?.files.length ?? 0} files</span></header>
        <div>{selected ? <PushFileTree changes={selected.files} /> : <div className="dialog-empty">Select a commit</div>}</div>
      </section>
    </div>
    <footer className="dialog-footer"><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="dialog-primary" onClick={onPush}>Push</button></footer>
  </>;
}

interface PushFileNode {
  name: string;
  path: string;
  children: Map<string, PushFileNode>;
  change?: CommitFileChange;
}

export function PushFileTree({ changes, onOpen, groupByDirectory = true }: { changes: readonly CommitFileChange[]; onOpen?(change: CommitFileChange): void; groupByDirectory?: boolean }) {
  if (!groupByDirectory) return <>{[...changes].sort((left, right) => left.path.localeCompare(right.path)).map(change => <PushFlatFile key={change.path} change={change} onOpen={onOpen} />)}</>;
  const root: PushFileNode = { name: '', path: '', children: new Map() };
  for (const change of changes) {
    let node = root;
    const parts = change.path.split('/');
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      const child = node.children.get(part) ?? { name: part, path, children: new Map() };
      node.children.set(part, child);
      node = child;
    });
    node.change = change;
  }
  return <>{sortedChildren(root).map(node => <PushFileNodeView key={node.path} node={node} onOpen={onOpen} />)}</>;
}

function PushFlatFile({ change, onOpen }: { change: CommitFileChange; onOpen?: ((change: CommitFileChange) => void) | undefined }) {
  const separator = change.path.lastIndexOf('/');
  const name = separator < 0 ? change.path : change.path.slice(separator + 1);
  const directory = separator < 0 ? '' : change.path.slice(0, separator);
  return onOpen
    ? <button type="button" className={`push-file push-flat-file file-status-${change.status}`} title={`Show diff for ${change.path}`} onClick={() => onOpen(change)}><span>{name}</span>{directory && <small>{directory}</small>}</button>
    : <div className={`push-file push-flat-file file-status-${change.status}`} title={change.path}><span>{name}</span>{directory && <small>{directory}</small>}</div>;
}

function PushFileNodeView({ node, onOpen }: { node: PushFileNode; onOpen?: ((change: CommitFileChange) => void) | undefined }) {
  if (node.change) return onOpen
    ? <button type="button" className={`push-file file-status-${node.change.status}`} title={`Show diff for ${node.path}`} onClick={() => onOpen(node.change!)}><span>{node.name}</span></button>
    : <div className={`push-file file-status-${node.change.status}`} title={node.path}><span>{node.name}</span></div>;
  const compact = compactDirectory(node);
  const count = pushFileCount(compact.node);
  return <details className="push-folder" open><summary>{compact.label}<span className="folder-file-count">{count} {count === 1 ? 'file' : 'files'}</span></summary><div>{sortedChildren(compact.node).map(child => <PushFileNodeView key={child.path} node={child} onOpen={onOpen} />)}</div></details>;
}

function sortedChildren(node: PushFileNode): PushFileNode[] {
  return [...node.children.values()].sort((left, right) => Number(Boolean(left.change)) - Number(Boolean(right.change)) || left.name.localeCompare(right.name));
}

function compactDirectory(start: PushFileNode): { label: string; node: PushFileNode } {
  let label = start.name;
  let node = start;
  while (!node.change && node.children.size === 1) {
    const child = [...node.children.values()][0]!;
    if (child.change) break;
    label += `/${child.name}`;
    node = child;
  }
  return { label, node };
}

function pushFileCount(node: PushFileNode): number {
  if (node.change) return 1;
  return [...node.children.values()].reduce((count, child) => count + pushFileCount(child), 0);
}

function trapFocus(event: KeyboardEvent, element: HTMLElement | null): void {
  if (!element) return;
  const focusable = [...element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
