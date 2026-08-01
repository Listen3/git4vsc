import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CommitFileChange, DialogListItem, WebviewDialogRequest } from '@git4vsc/shared-types';
import { formatCommitTime } from './commit-date.js';

export function DialogHost({ dialog, onResolve }: { dialog: WebviewDialogRequest | null; onResolve(value: string | null): void }) {
  const frame = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  useEffect(() => {
    if (!dialog) {
      returnFocus.current?.focus();
      return;
    }
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setSelectedId(dialog?.kind === 'list' ? dialog.items.find(item => !item.separator)?.id ?? null : null);
    setSelectedHash(dialog?.kind === 'push-preview' ? dialog.commits[0]?.commit.hash ?? null : null);
    requestAnimationFrame(() => search.current?.focus() ?? frame.current?.focus());
  }, [dialog]);

  const visibleItems = useMemo(() => dialog?.kind === 'list' ? filterDialogItems(dialog.items, query) : [], [dialog, query]);
  useEffect(() => {
    if (dialog?.kind !== 'list' || visibleItems.some(item => !item.separator && item.id === selectedId)) return;
    setSelectedId(visibleItems.find(item => !item.separator)?.id ?? null);
  }, [dialog, selectedId, visibleItems]);
  if (!dialog) return null;

  const selectable = visibleItems.filter(item => !item.separator);
  const move = (delta: number) => {
    if (!selectable.length) return;
    const current = selectable.findIndex(item => item.id === selectedId);
    setSelectedId(selectable[(current + delta + selectable.length) % selectable.length]!.id);
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onResolve(null); }
    else if (event.key === 'ArrowDown' && dialog.kind === 'list') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp' && dialog.kind === 'list') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter' && dialog.kind === 'list' && selectedId) { event.preventDefault(); onResolve(selectedId); }
    else if (event.key === 'Tab') trapFocus(event, frame.current);
  };

  return <div className="dialog-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onResolve(null); }}>
    <div ref={frame} className={`dialog-frame dialog-${dialog.kind}`} role="dialog" aria-modal="true" aria-labelledby={`dialog-title-${dialog.id}`} tabIndex={-1} onKeyDown={keydown}>
      <header className="dialog-header"><strong id={`dialog-title-${dialog.id}`}>{dialog.title}</strong><button type="button" aria-label="Close" onClick={() => onResolve(null)}>×</button></header>
      {dialog.kind === 'list'
        ? <>
          <div className="dialog-search"><span className="sidebar-search-icon" /><input ref={search} value={query} aria-label="Filter options" placeholder={dialog.placeholder ?? 'Search'} onChange={event => setQuery(event.target.value)} /></div>
          <div className="dialog-list" role="listbox">
            {visibleItems.map(item => item.separator
              ? <div key={item.id} className="dialog-list-separator">{item.label}</div>
              : <button key={item.id} type="button" role="option" aria-selected={item.id === selectedId} className={item.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(item.id)} onDoubleClick={() => onResolve(item.id)}>
                <span className="dialog-item-label">{item.label}</span>{item.description && <span className="dialog-item-description">{item.description}</span>}{item.detail && <small>{item.detail}</small>}
              </button>)}
            {!selectable.length && <div className="dialog-empty">No matching items</div>}
          </div>
          <footer className="dialog-footer"><button type="button" onClick={() => onResolve(null)}>Cancel</button><button type="button" className="dialog-primary" disabled={!selectedId} onClick={() => onResolve(selectedId)}>{dialog.acceptLabel ?? 'Select'}</button></footer>
        </>
        : <PushPreview dialog={dialog} selectedHash={selectedHash} onSelect={setSelectedHash} onCancel={() => onResolve(null)} onPush={() => onResolve('push')} />}
    </div>
  </div>;
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

function PushFileTree({ changes }: { changes: readonly CommitFileChange[] }) {
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
  return <>{sortedChildren(root).map(node => <PushFileNodeView key={node.path} node={node} />)}</>;
}

function PushFileNodeView({ node }: { node: PushFileNode }) {
  if (node.change) return <div className={`push-file file-status-${node.change.status}`} title={node.path}><span>{node.name}</span></div>;
  const compact = compactDirectory(node);
  return <details className="push-folder" open><summary>{compact.label}</summary><div>{sortedChildren(compact.node).map(child => <PushFileNodeView key={child.path} node={child} />)}</div></details>;
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

function trapFocus(event: KeyboardEvent, element: HTMLElement | null): void {
  if (!element) return;
  const focusable = [...element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
