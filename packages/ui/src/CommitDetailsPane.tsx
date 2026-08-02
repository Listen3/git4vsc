import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { CommitDetails, CommitFileChange } from '@git4vsc/shared-types';
import type { LogViewOptions } from './RepositoryPanel.js';
import { ContextMenu, type ContextMenuItem } from './ContextMenu.js';
import { OverlayScrollbar } from './OverlayScrollbar.js';

export type CommitFileAction =
  | 'showDiff' | 'showDiffNewTab' | 'compareLocal' | 'compareBeforeLocal'
  | 'editSource' | 'openRepositoryVersion' | 'revertSelected' | 'cherryPickSelected'
  | 'createPatch' | 'getFromRevision' | 'historyUpToHere' | 'showChangesToParent' | 'copyPath';

interface FileNode {
  name: string;
  path: string;
  children: Map<string, FileNode>;
  change?: CommitFileChange;
}

export function fileTree(changes: readonly CommitFileChange[]): FileNode {
  const root: FileNode = { name: '', path: '', children: new Map() };
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
  return root;
}

export function CommitDetailsPane({ details, loading, groupByDirectory, showDetails, onOptionsChange, onOpenFile, onFileAction }: {
  details: CommitDetails | null;
  loading?: boolean | undefined;
  groupByDirectory: boolean;
  showDetails: boolean;
  onOptionsChange?: ((options: LogViewOptions) => void) | undefined;
  onOpenFile?: ((change: CommitFileChange) => void) | undefined;
  onFileAction?: ((action: CommitFileAction, changes: readonly CommitFileChange[]) => void) | undefined;
}) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [optionsMenu, setOptionsMenu] = useState<{ x: number; y: number } | null>(null);
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; changes: CommitFileChange[] } | null>(null);
  const fileTreeRef = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => fileTree(details?.files ?? []), [details]);
  useEffect(() => { setSelectedPaths(new Set()); setSelectionAnchor(null); setFileMenu(null); }, [details?.hash]);
  if (loading) return <aside className="details-pane details-loading"><span className="details-loading-spinner" /><span>Loading changes…</span></aside>;
  if (!details) return <aside className="details-pane details-empty">Select a commit to view its details and changed files.</aside>;

  const displayedChanges = groupByDirectory ? [...details.files].sort((left, right) => left.path.localeCompare(right.path)) : details.files;
  const select = (change: CommitFileChange, event: MouseEvent) => {
    const next = new Set(selectedPaths);
    if (event.shiftKey && selectionAnchor) {
      const start = displayedChanges.findIndex(file => file.path === selectionAnchor);
      const end = displayedChanges.findIndex(file => file.path === change.path);
      if (!event.ctrlKey && !event.metaKey) next.clear();
      for (let index = Math.min(start, end); index <= Math.max(start, end); index += 1) next.add(displayedChanges[index]!.path);
    } else if (event.ctrlKey || event.metaKey) {
      if (next.has(change.path)) next.delete(change.path); else next.add(change.path);
    } else {
      next.clear();
      next.add(change.path);
    }
    setSelectedPaths(next);
    setSelectionAnchor(change.path);
  };
  const selected = details.files.filter(change => selectedPaths.has(change.path));
  const updateOptions = (patch: Partial<LogViewOptions>) => onOptionsChange?.({ groupByDirectory, showDetails, ...patch });
  const openFileMenu = (change: CommitFileChange, event: MouseEvent) => {
    event.preventDefault();
    const paths = selectedPaths.has(change.path) ? selectedPaths : new Set([change.path]);
    if (!selectedPaths.has(change.path)) setSelectedPaths(paths);
    setSelectionAnchor(change.path);
    setFileMenu({ x: event.clientX, y: event.clientY, changes: details.files.filter(file => paths.has(file.path)) });
  };

  return (
    <aside className="details-pane" aria-label="Commit details">
      <section className={`changed-files${showDetails ? '' : ' changed-files-full'}`}>
        <header className="changed-files-toolbar">
          <strong>Changes</strong><span>{details.files.length} files</span><span className="toolbar-spacer" />
          <button type="button" className="details-action" disabled={selected.length === 0} title="Revert Selected Changes" aria-label="Revert Selected Changes" onClick={() => onFileAction?.('revertSelected', selected)}><RevertIcon /></button>
          <button type="button" className="details-action" title="View Options" aria-label="View Options" onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            setOptionsMenu({ x: rect.right, y: rect.bottom + 2 });
          }}><EyeIcon /></button>
        </header>
        <div ref={fileTreeRef} className="file-tree">
          {groupByDirectory
            ? sortedNodes(tree).map(node => <FileTreeNode key={node.path} node={node} selectedPaths={selectedPaths} onSelect={select} onOpenFile={onOpenFile} onContextMenu={openFileMenu} />)
            : details.files.map(change => <FileChangeRow key={change.path} change={change} name={baseName(change.path)} directory={directoryName(change.path)} selected={selectedPaths.has(change.path)} onSelect={select} onOpenFile={onOpenFile} onContextMenu={openFileMenu} />)}
        </div>
        <OverlayScrollbar targetRef={fileTreeRef} />
      </section>
      {showDetails && <CommitInformation details={details} />}
      {optionsMenu && <DetailsOptionsMenu x={optionsMenu.x} y={optionsMenu.y} groupByDirectory={groupByDirectory} showDetails={showDetails} onClose={() => setOptionsMenu(null)} onChange={updateOptions} />}
      {fileMenu && <ContextMenu x={fileMenu.x} y={fileMenu.y} items={buildCommitFileMenu(fileMenu.changes, details.parents.length > 1)} onClose={() => setFileMenu(null)} onSelect={action => onFileAction?.(action as CommitFileAction, fileMenu.changes)} />}
    </aside>
  );
}

function CommitInformation({ details }: { details: CommitDetails }) {
  const detailsRef = useRef<HTMLElement>(null);
  return <div className="commit-details-wrap"><section ref={detailsRef} className="commit-details">
    <h2>{details.subject}</h2>
    <div className="commit-meta"><code title={details.hash}>{details.hash.slice(0, 10)}</code><span>{details.authorName} &lt;{details.authorEmail}&gt;</span><time>{new Date(details.authorTime * 1000).toLocaleString()}</time></div>
    {details.committerName !== details.authorName && <div className="commit-secondary">Committed by {details.committerName} &lt;{details.committerEmail}&gt;</div>}
    {details.refs.length > 0 && <div className="detail-refs">{details.refs.map(ref => <span key={ref.fullName}>{ref.name}</span>)}</div>}
    <pre>{details.message}</pre>
    {details.containingBranches.length > 0 && <div className="containing-branches"><strong>In {details.containingBranches.length} branches:</strong> {details.containingBranches.join(', ')}</div>}
    {details.parents.length > 1 && <div className="merge-note">Changes are shown against the first parent {details.parents[0]?.slice(0, 8)}.</div>}
  </section><OverlayScrollbar targetRef={detailsRef} /></div>;
}

function FileTreeNode({ node, selectedPaths, onSelect, onOpenFile, onContextMenu }: {
  node: FileNode;
  selectedPaths: ReadonlySet<string>;
  onSelect: (change: CommitFileChange, event: MouseEvent) => void;
  onOpenFile?: ((change: CommitFileChange) => void) | undefined;
  onContextMenu: (change: CommitFileChange, event: MouseEvent) => void;
}) {
  if (node.change) return <FileChangeRow change={node.change} name={node.name} selected={selectedPaths.has(node.path)} onSelect={onSelect} onOpenFile={onOpenFile} onContextMenu={onContextMenu} />;
  const compact = compactDirectory(node);
  const count = fileCount(compact.node);
  return <details className="file-folder" open>
    <summary title={compact.node.path}><FolderIcon />{compact.label}<span className="folder-file-count">{count} {count === 1 ? 'file' : 'files'}</span></summary>
    <div>{sortedNodes(compact.node).map(child => <FileTreeNode key={child.path} node={child} selectedPaths={selectedPaths} onSelect={onSelect} onOpenFile={onOpenFile} onContextMenu={onContextMenu} />)}</div>
  </details>;
}

function FileChangeRow({ change, name, directory, selected, onSelect, onOpenFile, onContextMenu }: {
  change: CommitFileChange;
  name: string;
  directory?: string | undefined;
  selected: boolean;
  onSelect: (change: CommitFileChange, event: MouseEvent) => void;
  onOpenFile?: ((change: CommitFileChange) => void) | undefined;
  onContextMenu: (change: CommitFileChange, event: MouseEvent) => void;
}) {
  return <button type="button" className={`file-change${selected ? ' selected' : ''}`} title={change.originalPath ? `${change.originalPath} → ${change.path}` : change.path} onClick={event => onSelect(change, event)} onDoubleClick={() => onOpenFile?.(change)} onContextMenu={event => onContextMenu(change, event)}>
    <span className={`file-change-name file-change-${change.status}`}>{name}</span>{directory && <span className="file-change-directory">{directory}</span>}
  </button>;
}

export function buildCommitFileMenu(changes: readonly CommitFileChange[], multipleParents: boolean): ContextMenuItem[] {
  const single = changes.length === 1;
  const deleted = single && changes[0]?.status === 'deleted';
  return [
    { id: 'showDiff', label: 'Show Diff', disabled: !single },
    { id: 'showDiffNewTab', label: 'Show Diff in a New Tab', disabled: !single },
    { id: 'separator-view-1', separator: true },
    { id: 'compareLocal', label: 'Compare with Local', disabled: !single },
    { id: 'compareBeforeLocal', label: 'Compare Before with Local', disabled: !single },
    { id: 'editSource', label: 'Edit Source', disabled: !single },
    { id: 'openRepositoryVersion', label: 'Open Repository Version', disabled: !single || deleted },
    { id: 'separator-apply', separator: true },
    { id: 'revertSelected', label: 'Revert Selected Changes…' },
    { id: 'cherryPickSelected', label: 'Cherry-Pick Selected Changes…' },
    { id: 'createPatch', label: 'Create Patch…' },
    { id: 'getFromRevision', label: 'Get from Revision…' },
    { id: 'separator-history', separator: true },
    { id: 'historyUpToHere', label: 'History Up to Here' },
    ...(multipleParents ? [{ id: 'showChangesToParent', label: 'Show Changes to Parent…', disabled: !single }] : []),
    { id: 'copyPath', label: changes.length === 1 ? 'Copy Path' : 'Copy Paths' }
  ];
}

function DetailsOptionsMenu({ x, y, groupByDirectory, showDetails, onChange, onClose }: {
  x: number;
  y: number;
  groupByDirectory: boolean;
  showDetails: boolean;
  onChange: (patch: Partial<LogViewOptions>) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', keydown); };
  }, [onClose]);
  return <div className="details-options-menu" style={{ left: Math.max(8, Math.min(x - 210, window.innerWidth - 218)), top: Math.min(y, window.innerHeight - 116) }} onPointerDown={event => event.stopPropagation()}>
    <div className="details-options-title">Group By</div>
    <button type="button" onClick={() => onChange({ groupByDirectory: !groupByDirectory })}><span className="menu-check">{groupByDirectory ? '✓' : ''}</span>Directory</button>
    <div className="context-menu-separator" />
    <div className="details-options-title">Layout</div>
    <button type="button" onClick={() => onChange({ showDetails: !showDetails })}><span className="menu-check">{showDetails ? '✓' : ''}</span>Show Details</button>
  </div>;
}

function sortedNodes(node: FileNode): FileNode[] {
  return [...node.children.values()].sort((left, right) => Number(Boolean(left.change)) - Number(Boolean(right.change)) || left.name.localeCompare(right.name));
}

function compactDirectory(start: FileNode): { label: string; node: FileNode } {
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

function fileCount(node: FileNode): number {
  if (node.change) return 1;
  return [...node.children.values()].reduce((count, child) => count + fileCount(child), 0);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function directoryName(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function RevertIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.2 4H3v-3M3.4 4.1A6 6 0 1 1 2.6 10" /></svg>;
}

function EyeIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.3-4 6.5-4 6.5 4 6.5 4-2.3 4-6.5 4S1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="1.8" /></svg>;
}

function FolderIcon() {
  return <svg className="folder-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4h5l1.2 1.4h6.8v7.1h-13Z" /></svg>;
}
