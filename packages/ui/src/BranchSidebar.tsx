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

  const menuItems: ContextMenuItem[] = menu ? buildBranchMenu(menu.ref, status, favoriteRefs) : [];

  return (
    <aside className="branch-sidebar" aria-label="Branches and tags">
      <div className="sidebar-search"><span className="sidebar-search-icon" aria-hidden="true" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Branch or tag" /></div>
      <nav className="branch-tree">
        <BranchItem label="All" active={activeRef === null} icon="◎" onClick={() => onSelectRef?.(null)} />
        <BranchItem label={status?.branch ? `HEAD (${status.branch})` : 'HEAD (Detached)'} active={activeRef === 'HEAD'} icon="◆" onClick={() => onSelectRef?.('HEAD')} onContextMenu={event => openMenu(event, currentRef)} />
        <BranchGroup label="Local" count={local.length} onContextMenu={event => openMenu(event, null)}>
          {local.map(ref => <BranchItem key={ref.fullName} label={ref.name} active={activeRef === ref.fullName} icon={ref.name === status?.branch ? '●' : '◇'} current={ref.name === status?.branch} favorite={favoriteRefs.includes(ref.fullName)} updateAvailable={hasRemoteUpdate(ref, status)} onClick={() => onSelectRef?.(ref.fullName)} onContextMenu={event => openMenu(event, ref)} />)}
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

export function buildBranchMenu(ref: GitRef | null, status: RepositoryStatus | null, favoriteRefs: readonly string[]): ContextMenuItem[] {
  if (!ref) return [
    { id: 'copy', label: 'Copy HEAD Revision' },
    { id: 'separator-1', separator: true },
    { id: 'createBranch', label: 'New Branch from Here…' },
    { id: 'createTag', label: 'New Tag from Here…' },
    { id: 'newWorktree', label: 'New Worktree from Here…' }
  ];
  const current = ref.type === 'local-branch' && ref.name === status?.branch;
  const branch = ref.type === 'local-branch' || ref.type === 'remote-branch';
  const hasCurrentBranch = Boolean(status?.branch);
  const currentTag = ref.type === 'tag' && !hasCurrentBranch && ref.hash === status?.head;
  const common: ContextMenuItem[] = [
    { id: 'copy', label: ref.type === 'tag' ? 'Copy Tag Name' : 'Copy Branch Name' },
    ...(branch ? [{ id: 'toggleFavorite', label: favoriteRefs.includes(ref.fullName) ? 'Remove from Favorites' : 'Add to Favorites' }] : [])
  ];

  if (ref.type === 'local-branch' && current) return joinMenuSections(
    common,
    [
      { id: 'checkoutNew', label: 'Checkout as New Branch…' },
      { id: 'newWorktree', label: 'New Worktree…' }
    ],
    [{ id: 'diffLocal', label: 'Show Diff with Local' }],
    [
      ...(status?.upstream ? [{ id: 'update', label: 'Update Selected Branch…' }] : []),
      { id: 'push', label: 'Push Branch…' },
      { id: 'setUpstream', label: 'Set Tracked Branch…' }
    ],
    [{ id: 'rename', label: 'Rename Branch…' }]
  );

  if (ref.type === 'local-branch') return joinMenuSections(
    common,
    [
      { id: 'checkout', label: 'Checkout' },
      { id: 'checkoutNew', label: 'Checkout as New Branch…' },
      ...(hasCurrentBranch ? [{ id: 'checkoutRebase', label: 'Checkout and Rebase onto Current…' }] : []),
      ...(ref.upstream ? [{ id: 'checkoutUpdate', label: 'Checkout and Update…' }] : []),
      { id: 'newWorktree', label: 'New Worktree…' }
    ],
    [
      { id: 'compare', label: 'Compare with Current' },
      { id: 'diffLocal', label: 'Show Diff with Local' },
      ...(hasCurrentBranch ? [
        { id: 'rebaseOnto', label: 'Rebase Current onto Selected…' },
        { id: 'merge', label: 'Merge into Current Branch…' }
      ] : [])
    ],
    [
      ...(ref.upstream ? [{ id: 'update', label: 'Update Selected Branch…' }] : []),
      { id: 'push', label: 'Push Branch…' },
      { id: 'setUpstream', label: 'Set Tracked Branch…' }
    ],
    [
      { id: 'rename', label: 'Rename Branch…' },
      { id: 'delete', label: 'Delete Branch…' }
    ]
  );

  if (ref.type === 'remote-branch') return joinMenuSections(
    common,
    [
      { id: 'checkout', label: 'Checkout' },
      { id: 'checkoutNew', label: 'Checkout as New Branch…' },
      ...(hasCurrentBranch ? [{ id: 'checkoutRebase', label: 'Checkout and Rebase onto Current…' }] : []),
      { id: 'newWorktree', label: 'New Worktree…' }
    ],
    [
      { id: 'compare', label: 'Compare with Current' },
      { id: 'diffLocal', label: 'Show Diff with Local' },
      ...(hasCurrentBranch ? [
        { id: 'rebaseOnto', label: 'Rebase Current onto Selected…' },
        { id: 'merge', label: 'Merge into Current Branch…' }
      ] : [])
    ],
    hasCurrentBranch ? [
      { id: 'pullRebase', label: 'Pull into Current Using Rebase…' },
      { id: 'pullMerge', label: 'Pull into Current Using Merge…' }
    ] : [],
    [{ id: 'delete', label: 'Delete Remote Branch…' }]
  );

  return joinMenuSections(
    common,
    currentTag ? [] : [{ id: 'checkout', label: 'Checkout Tag (Detached)' }],
    [
      { id: 'newWorktree', label: 'New Worktree…' },
      { id: 'diffLocal', label: 'Show Diff with Local' },
      ...(!currentTag && hasCurrentBranch ? [{ id: 'merge', label: 'Merge into Current Branch…' }] : [])
    ],
    [
      { id: 'push', label: 'Push Tag…' },
      ...(!currentTag ? [{ id: 'delete', label: 'Delete Tag…' }] : [])
    ]
  );
}

export function hasRemoteUpdate(ref: GitRef, status: RepositoryStatus | null): boolean {
  if (ref.type !== 'local-branch') return false;
  if (ref.tracking === 'behind' || ref.tracking === 'diverged') return true;
  return ref.name === status?.branch && status.behind > 0;
}

function joinMenuSections(...sections: ContextMenuItem[][]): ContextMenuItem[] {
  return sections.filter(section => section.length > 0).flatMap((section, index) =>
    index === 0 ? section : [{ id: `separator-${index}`, separator: true }, ...section]
  );
}

function BranchGroup({ label, count, nested = false, children, onContextMenu }: { label: string; count: number; nested?: boolean; children: React.ReactNode; onContextMenu?: ((event: MouseEvent) => void) | undefined }) {
  return (
    <details className={`branch-group${nested ? ' branch-group-nested' : ''}`} open>
      <summary onContextMenu={onContextMenu}><span>{label}</span><span className="branch-count">{count}</span></summary>
      <div>{children}</div>
    </details>
  );
}

function BranchItem({ label, icon, active, current, favorite, updateAvailable, onClick, onContextMenu }: {
  label: string;
  icon: string;
  active?: boolean;
  current?: boolean;
  favorite?: boolean;
  updateAvailable?: boolean;
  onClick: () => void;
  onContextMenu?: ((event: MouseEvent) => void) | undefined;
}) {
  return <button type="button" className={`branch-item${active ? ' active' : ''}${current ? ' current' : ''}`} onClick={onClick} onContextMenu={onContextMenu}><span className="branch-icon">{icon}</span><span className="branch-label">{label}</span>{updateAvailable && <span className="branch-update" title="Updates available">↙</span>}{favorite && <span className="branch-favorite">★</span>}</button>;
}
