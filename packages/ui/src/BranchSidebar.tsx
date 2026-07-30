import { useMemo, useState, type MouseEvent } from 'react';
import type { GitRef, RepositoryStatus } from '@git4vsc/shared-types';
import { ContextMenu, type ContextMenuItem } from './ContextMenu.js';

export type RefAction =
  | 'copy' | 'toggleFavorite'
  | 'checkout' | 'checkoutUpdate' | 'checkoutRebase' | 'checkoutNew' | 'createBranch' | 'createTag' | 'newWorktree'
  | 'compare' | 'diffLocal' | 'rebaseOnto' | 'merge'
  | 'update' | 'push' | 'setUpstream' | 'pullMerge' | 'pullRebase'
  | 'rename' | 'delete';
export type RemoteAction = 'fetch' | 'add' | 'edit' | 'remove';

export function BranchSidebar({ status, activeRef, favoriteRefs = [], onSelectRef, onRefAction, onRemoteAction }: {
  status: RepositoryStatus | null;
  activeRef: string | null;
  favoriteRefs?: readonly string[] | undefined;
  onSelectRef?: ((ref: string | null) => void) | undefined;
  onRefAction?: ((action: RefAction, ref: GitRef | null) => void) | undefined;
  onRemoteAction?: ((action: RemoteAction, remote: string | null) => void) | undefined;
}) {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; ref: GitRef | null } | null>(null);
  const [remoteMenu, setRemoteMenu] = useState<{ x: number; y: number; remote: string | null } | null>(null);
  const refs = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = needle ? status?.refs.filter(ref => ref.name.toLocaleLowerCase().includes(needle)) ?? [] : status?.refs ?? [];
    return [...filtered].sort((a, b) => Number(favoriteRefs.includes(b.fullName)) - Number(favoriteRefs.includes(a.fullName)) || a.name.localeCompare(b.name));
  }, [favoriteRefs, query, status]);
  const local = refs.filter(ref => ref.type === 'local-branch');
  const tags = refs.filter(ref => ref.type === 'tag');
  const remoteGroups = new Map<string, GitRef[]>();
  for (const ref of refs.filter(ref => ref.type === 'remote-branch')) {
    const remote = ref.remote ?? 'remote';
    remoteGroups.set(remote, [...(remoteGroups.get(remote) ?? []), ref]);
  }
  const currentRef = status?.branch ? status.refs.find(ref => ref.type === 'local-branch' && ref.name === status.branch) ?? null : null;

  function openMenu(event: MouseEvent, ref: GitRef | null) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, ref });
  }

  function openRemoteMenu(event: MouseEvent, remote: string | null) {
    event.preventDefault();
    setRemoteMenu({ x: event.clientX, y: event.clientY, remote });
  }

  const menuItems: ContextMenuItem[] = menu ? buildMenu(menu.ref, status, favoriteRefs) : [];

  return (
    <aside className="branch-sidebar" aria-label="Branches and tags">
      <div className="sidebar-search"><span className="codicon codicon-search">⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Branch or tag" /></div>
      <nav className="branch-tree">
        <BranchItem label="All" active={activeRef === null} icon="◎" onClick={() => onSelectRef?.(null)} />
        <BranchItem label={status?.branch ? `HEAD (${status.branch})` : 'HEAD (Detached)'} active={activeRef === 'HEAD'} icon="◆" onClick={() => onSelectRef?.('HEAD')} onContextMenu={event => openMenu(event, currentRef)} />
        <BranchGroup label="Local" count={local.length} onContextMenu={event => openMenu(event, null)}>
          {local.map(ref => <BranchItem key={ref.fullName} label={ref.name} active={activeRef === ref.fullName} icon={ref.name === status?.branch ? '●' : '◇'} current={ref.name === status?.branch} favorite={favoriteRefs.includes(ref.fullName)} onClick={() => onSelectRef?.(ref.fullName)} onContextMenu={event => openMenu(event, ref)} />)}
        </BranchGroup>
        <BranchGroup label="Remote" count={[...remoteGroups.values()].reduce((sum, group) => sum + group.length, 0)} onContextMenu={event => openRemoteMenu(event, null)}>
          {[...remoteGroups.entries()].map(([remote, remoteRefs]) => (
            <BranchGroup label={remote} count={remoteRefs.length} nested key={remote} onContextMenu={event => openRemoteMenu(event, remote)}>
              {remoteRefs.map(ref => <BranchItem key={ref.fullName} label={ref.name.slice(remote.length + 1)} active={activeRef === ref.fullName} icon="◇" favorite={favoriteRefs.includes(ref.fullName)} onClick={() => onSelectRef?.(ref.fullName)} onContextMenu={event => openMenu(event, ref)} />)}
            </BranchGroup>
          ))}
        </BranchGroup>
        {tags.length > 0 && <BranchGroup label="Tags" count={tags.length} onContextMenu={event => openMenu(event, null)}>
          {tags.map(ref => <BranchItem key={ref.fullName} label={ref.name} active={activeRef === ref.fullName} icon="◆" onClick={() => onSelectRef?.(ref.fullName)} onContextMenu={event => openMenu(event, ref)} />)}
        </BranchGroup>}
      </nav>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} onSelect={id => onRefAction?.(id as RefAction, menu.ref)} />}
      {remoteMenu && <ContextMenu x={remoteMenu.x} y={remoteMenu.y} items={remoteMenu.remote ? [
        { id: 'fetch', label: `Fetch ${remoteMenu.remote}` },
        { id: 'edit', label: 'Edit Remote URL…' },
        { id: 'separator-1', separator: true },
        { id: 'remove', label: 'Remove Remote…' }
      ] : [
        { id: 'fetch', label: 'Fetch All Remotes' },
        { id: 'add', label: 'Add Remote…' }
      ]} onClose={() => setRemoteMenu(null)} onSelect={id => onRemoteAction?.(id as RemoteAction, remoteMenu.remote)} />}
    </aside>
  );
}

function buildMenu(ref: GitRef | null, status: RepositoryStatus | null, favoriteRefs: readonly string[]): ContextMenuItem[] {
  if (!ref) return [
    { id: 'copy', label: 'Copy HEAD Revision' },
    { id: 'separator-1', separator: true },
    { id: 'createBranch', label: 'New Branch from Here…' },
    { id: 'createTag', label: 'New Tag from Here…' },
    { id: 'newWorktree', label: 'New Worktree from Here…' }
  ];
  const current = ref.type === 'local-branch' && ref.name === status?.branch;
  const branch = ref.type === 'local-branch' || ref.type === 'remote-branch';
  const items: ContextMenuItem[] = [
    { id: 'copy', label: ref.type === 'tag' ? 'Copy Tag Name' : 'Copy Branch Name' },
    ...(branch ? [{ id: 'toggleFavorite', label: favoriteRefs.includes(ref.fullName) ? 'Remove from Favorites' : 'Add to Favorites' }] : []),
    { id: 'separator-1', separator: true },
    { id: 'checkout', label: ref.type === 'tag' ? 'Checkout Tag (Detached)' : 'Checkout', disabled: current },
    ...(ref.type === 'local-branch' ? [
      { id: 'checkoutUpdate', label: 'Checkout and Update…', disabled: current },
      { id: 'checkoutRebase', label: 'Checkout and Rebase onto Current…', disabled: current }
    ] : []),
    { id: 'checkoutNew', label: 'Checkout as New Branch…' },
    { id: 'createBranch', label: 'New Branch from Here…' },
    { id: 'createTag', label: 'New Tag from Here…' },
    { id: 'newWorktree', label: 'New Worktree…' },
    { id: 'separator-2', separator: true },
    { id: 'compare', label: 'Compare with Current', disabled: current },
    { id: 'diffLocal', label: 'Show Diff with Local', disabled: current },
    { id: 'rebaseOnto', label: 'Rebase Current onto Selected…', disabled: current || ref.type === 'tag' },
    { id: 'merge', label: 'Merge into Current Branch…', disabled: current },
    { id: 'separator-3', separator: true }
  ];
  if (ref.type === 'local-branch') items.push(
    { id: 'update', label: 'Update Selected Branch…' },
    { id: 'push', label: 'Push Branch…' },
    { id: 'setUpstream', label: 'Set Tracked Branch…' },
    { id: 'separator-4', separator: true },
    { id: 'rename', label: 'Rename Branch…' },
    { id: 'delete', label: 'Delete Branch…', disabled: current }
  );
  else if (ref.type === 'remote-branch') items.push(
    { id: 'pullMerge', label: 'Pull into Current Using Merge…' },
    { id: 'pullRebase', label: 'Pull into Current Using Rebase…' },
    { id: 'separator-4', separator: true },
    { id: 'delete', label: 'Delete Remote Branch…' }
  );
  else items.push(
    { id: 'push', label: 'Push Tag…' },
    { id: 'delete', label: 'Delete Tag…' }
  );
  return items;
}

function BranchGroup({ label, count, nested = false, children, onContextMenu }: { label: string; count: number; nested?: boolean; children: React.ReactNode; onContextMenu?: ((event: MouseEvent) => void) | undefined }) {
  return (
    <details className={`branch-group${nested ? ' branch-group-nested' : ''}`} open>
      <summary onContextMenu={onContextMenu}><span>{label}</span><span className="branch-count">{count}</span></summary>
      <div>{children}</div>
    </details>
  );
}

function BranchItem({ label, icon, active, current, favorite, onClick, onContextMenu }: {
  label: string;
  icon: string;
  active?: boolean;
  current?: boolean;
  favorite?: boolean;
  onClick: () => void;
  onContextMenu?: ((event: MouseEvent) => void) | undefined;
}) {
  return <button type="button" className={`branch-item${active ? ' active' : ''}${current ? ' current' : ''}`} onClick={onClick} onContextMenu={onContextMenu}><span className="branch-icon">{icon}</span><span className="branch-label">{label}</span>{favorite && <span className="branch-favorite">★</span>}</button>;
}
