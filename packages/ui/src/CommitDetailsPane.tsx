import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { CommitDetails, CommitFileChange } from '@git4vsc/shared-types';
import type { LogViewOptions } from './RepositoryPanel.js';

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

const statusLetter: Record<CommitFileChange['status'], string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C', 'type-changed': 'T', unmerged: 'U'
};

export function CommitDetailsPane({ details, loading, groupByDirectory, showDetails, onOptionsChange, onOpenFile, onRevertChanges }: {
  details: CommitDetails | null;
  loading?: boolean | undefined;
  groupByDirectory: boolean;
  showDetails: boolean;
  onOptionsChange?: ((options: LogViewOptions) => void) | undefined;
  onOpenFile?: ((change: CommitFileChange) => void) | undefined;
  onRevertChanges?: ((changes: readonly CommitFileChange[]) => void) | undefined;
}) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [optionsMenu, setOptionsMenu] = useState<{ x: number; y: number } | null>(null);
  const tree = useMemo(() => fileTree(details?.files ?? []), [details]);
  useEffect(() => { setSelectedPaths(new Set()); setSelectionAnchor(null); }, [details?.hash]);
  if (loading) return <aside className="details-pane details-empty">Loading commit details…</aside>;
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

  return (
    <aside className="details-pane" aria-label="Commit details">
      <section className={`changed-files${showDetails ? '' : ' changed-files-full'}`}>
        <header className="changed-files-toolbar">
          <strong>Changes</strong><span>{details.files.length} files</span><span className="toolbar-spacer" />
          <button type="button" className="details-action" disabled={selected.length === 0} title="Revert Selected Changes" aria-label="Revert Selected Changes" onClick={() => onRevertChanges?.(selected)}><RevertIcon /></button>
          <button type="button" className="details-action" title="View Options" aria-label="View Options" onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            setOptionsMenu({ x: rect.right, y: rect.bottom + 2 });
          }}><EyeIcon /></button>
        </header>
        <div className="file-tree">
          {groupByDirectory
            ? sortedNodes(tree).map(node => <FileTreeNode key={node.path} node={node} selectedPaths={selectedPaths} onSelect={select} onOpenFile={onOpenFile} />)
            : details.files.map(change => <FileChangeRow key={change.path} change={change} name={baseName(change.path)} directory={directoryName(change.path)} selected={selectedPaths.has(change.path)} onSelect={select} onOpenFile={onOpenFile} />)}
        </div>
      </section>
      {showDetails && <CommitInformation details={details} />}
      {optionsMenu && <DetailsOptionsMenu x={optionsMenu.x} y={optionsMenu.y} groupByDirectory={groupByDirectory} showDetails={showDetails} onClose={() => setOptionsMenu(null)} onChange={updateOptions} />}
    </aside>
  );
}

function CommitInformation({ details }: { details: CommitDetails }) {
  return <section className="commit-details">
    <h2>{details.subject}</h2>
    <div className="commit-meta"><code title={details.hash}>{details.hash.slice(0, 10)}</code><span>{details.authorName} &lt;{details.authorEmail}&gt;</span><time>{new Date(details.authorTime * 1000).toLocaleString()}</time></div>
    {details.committerName !== details.authorName && <div className="commit-secondary">Committed by {details.committerName} &lt;{details.committerEmail}&gt;</div>}
    {details.refs.length > 0 && <div className="detail-refs">{details.refs.map(ref => <span key={ref.fullName}>{ref.name}</span>)}</div>}
    <pre>{details.message}</pre>
    {details.containingBranches.length > 0 && <div className="containing-branches"><strong>In {details.containingBranches.length} branches:</strong> {details.containingBranches.join(', ')}</div>}
    {details.parents.length > 1 && <div className="merge-note">Changes are shown against the first parent {details.parents[0]?.slice(0, 8)}.</div>}
  </section>;
}

function FileTreeNode({ node, selectedPaths, onSelect, onOpenFile }: {
  node: FileNode;
  selectedPaths: ReadonlySet<string>;
  onSelect: (change: CommitFileChange, event: MouseEvent) => void;
  onOpenFile?: ((change: CommitFileChange) => void) | undefined;
}) {
  if (node.change) return <FileChangeRow change={node.change} name={node.name} selected={selectedPaths.has(node.path)} onSelect={onSelect} onOpenFile={onOpenFile} />;
  const compact = compactDirectory(node);
  return <details className="file-folder" open>
    <summary title={compact.node.path}><FolderIcon />{compact.label}</summary>
    <div>{sortedNodes(compact.node).map(child => <FileTreeNode key={child.path} node={child} selectedPaths={selectedPaths} onSelect={onSelect} onOpenFile={onOpenFile} />)}</div>
  </details>;
}

function FileChangeRow({ change, name, directory, selected, onSelect, onOpenFile }: {
  change: CommitFileChange;
  name: string;
  directory?: string | undefined;
  selected: boolean;
  onSelect: (change: CommitFileChange, event: MouseEvent) => void;
  onOpenFile?: ((change: CommitFileChange) => void) | undefined;
}) {
  return <button type="button" className={`file-change${selected ? ' selected' : ''}`} title={change.originalPath ? `${change.originalPath} → ${change.path}` : change.path} onClick={event => onSelect(change, event)} onDoubleClick={() => onOpenFile?.(change)}>
    <span className={`file-status file-status-${change.status}`}>{statusLetter[change.status]}</span><span className="file-change-name">{name}</span>{directory && <span className="file-change-directory">{directory}</span>}
  </button>;
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
