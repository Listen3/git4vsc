import { useMemo } from 'react';
import type { CommitDetails, CommitFileChange } from '@git4vsc/shared-types';

interface FileNode {
  name: string;
  path: string;
  children: Map<string, FileNode>;
  change?: CommitFileChange;
}

function fileTree(changes: readonly CommitFileChange[]): FileNode {
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

export function CommitDetailsPane({ details, loading, onOpenFile }: {
  details: CommitDetails | null;
  loading?: boolean | undefined;
  onOpenFile?: ((change: CommitFileChange) => void) | undefined;
}) {
  const tree = useMemo(() => fileTree(details?.files ?? []), [details]);
  if (loading) return <aside className="details-pane details-empty">Loading commit details…</aside>;
  if (!details) return <aside className="details-pane details-empty">Select a commit to view its details and changed files.</aside>;
  return (
    <aside className="details-pane" aria-label="Commit details">
      <section className="changed-files">
        <header><strong>Changes</strong><span>{details.files.length} files</span></header>
        <div className="file-tree">{[...tree.children.values()].map(node => <FileTreeNode key={node.path} node={node} onOpenFile={onOpenFile} />)}</div>
      </section>
      <section className="commit-details">
        <h2>{details.subject}</h2>
        <div className="commit-meta"><code title={details.hash}>{details.hash.slice(0, 10)}</code><span>{details.authorName} &lt;{details.authorEmail}&gt;</span><time>{new Date(details.authorTime * 1000).toLocaleString()}</time></div>
        {details.committerName !== details.authorName && <div className="commit-secondary">Committed by {details.committerName} &lt;{details.committerEmail}&gt;</div>}
        {details.refs.length > 0 && <div className="detail-refs">{details.refs.map(ref => <span key={ref.fullName}>{ref.name}</span>)}</div>}
        <pre>{details.message}</pre>
        {details.containingBranches.length > 0 && <div className="containing-branches"><strong>In {details.containingBranches.length} branches:</strong> {details.containingBranches.join(', ')}</div>}
        {details.parents.length > 1 && <div className="merge-note">Changes are shown against the first parent {details.parents[0]?.slice(0, 8)}.</div>}
      </section>
    </aside>
  );
}

function FileTreeNode({ node, onOpenFile }: { node: FileNode; onOpenFile?: ((change: CommitFileChange) => void) | undefined }) {
  if (node.change) {
    return <button type="button" className="file-change" title={node.change.originalPath ? `${node.change.originalPath} → ${node.change.path}` : node.change.path} onClick={() => onOpenFile?.(node.change!)}><span className={`file-status file-status-${node.change.status}`}>{statusLetter[node.change.status]}</span><span>{node.name}</span></button>;
  }
  return (
    <details className="file-folder" open>
      <summary>{node.name}</summary>
      <div>{[...node.children.values()].map(child => <FileTreeNode key={child.path} node={child} onOpenFile={onOpenFile} />)}</div>
    </details>
  );
}
