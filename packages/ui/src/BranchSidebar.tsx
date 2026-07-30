import { useMemo, useState, type MouseEvent } from 'react';
import type { GitRef, RepositoryStatus } from '@git4vsc/shared-types';
import { ContextMenu, type ContextMenuItem } from './ContextMenu.js';

export type RefAction = 'copy' | 'checkout' | 'createBranch' | 'compare' | 'merge';

export function BranchSidebar({ status, activeRef, onSelectRef, onRefAction }: {
  status: RepositoryStatus | null;
  activeRef: string | null;
  onSelectRef?: ((ref: string | null) => void) | undefined;
  onRefAction?: ((action: RefAction, ref: GitRef | null) => void) | undefined;
}) {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; ref: GitRef | null } | null>(null);
  const refs = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? status?.refs.filter(ref => ref.name.toLocaleLowerCase().includes(needle)) ?? [] : status?.refs ?? [];
  }, [query, status]);
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

  const menuItems: ContextMenuItem[] = menu ? [
    { id: 'copy', label: menu.ref ? 'Copy Branch Name' : 'Copy HEAD Revision' },
    { id: 'separator-1', separator: true },
    { id: 'checkout', label: 'Checkout', disabled: !menu.ref || menu.ref.name === status?.branch },
    { id: 'createBranch', label: 'New Branch from Here…' },
    { id: 'compare', label: 'Compare with Current', disabled: !menu.ref || menu.ref.name === status?.branch },
    { id: 'merge', label: 'Merge into Current Branch…', disabled: !menu.ref || menu.ref.name === status?.branch || menu.ref.type === 'tag' }
  ] : [];

  return (
    <aside className="branch-sidebar" aria-label="Branches and tags">
      <div className="sidebar-search"><span className="codicon codicon-search">⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Branch or tag" /></div>
      <nav className="branch-tree">
        <BranchItem label="All" active={activeRef === null} icon="◎" onClick={() => onSelectRef?.(null)} />
        <BranchItem label={status?.branch ? `HEAD (${status.branch})` : 'HEAD (Detached)'} active={activeRef === 'HEAD'} icon="◆" onClick={() => onSelectRef?.('HEAD')} onContextMenu={event => openMenu(event, currentRef)} />
        <BranchGroup label="Local" count={local.length}>
          {local.map(ref => <BranchItem key={ref.fullName} label={ref.name} active={activeRef === ref.fullName} icon={ref.name === status?.branch ? '●' : '◇'} current={ref.name === status?.branch} onClick={() => onSelectRef?.(ref.fullName)} onContextMenu={event => openMenu(event, ref)} />)}
        </BranchGroup>
        <BranchGroup label="Remote" count={[...remoteGroups.values()].reduce((sum, group) => sum + group.length, 0)}>
          {[...remoteGroups.entries()].map(([remote, remoteRefs]) => (
            <BranchGroup label={remote} count={remoteRefs.length} nested key={remote}>
              {remoteRefs.map(ref => <BranchItem key={ref.fullName} label={ref.name.slice(remote.length + 1)} active={activeRef === ref.fullName} icon="◇" onClick={() => onSelectRef?.(ref.fullName)} onContextMenu={event => openMenu(event, ref)} />)}
            </BranchGroup>
          ))}
        </BranchGroup>
        {tags.length > 0 && <BranchGroup label="Tags" count={tags.length}>
          {tags.map(ref => <BranchItem key={ref.fullName} label={ref.name} active={activeRef === ref.fullName} icon="◆" onClick={() => onSelectRef?.(ref.fullName)} onContextMenu={event => openMenu(event, ref)} />)}
        </BranchGroup>}
      </nav>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} onSelect={id => onRefAction?.(id as RefAction, menu.ref)} />}
    </aside>
  );
}

function BranchGroup({ label, count, nested = false, children }: { label: string; count: number; nested?: boolean; children: React.ReactNode }) {
  return (
    <details className={`branch-group${nested ? ' branch-group-nested' : ''}`} open>
      <summary><span>{label}</span><span className="branch-count">{count}</span></summary>
      <div>{children}</div>
    </details>
  );
}

function BranchItem({ label, icon, active, current, onClick, onContextMenu }: {
  label: string;
  icon: string;
  active?: boolean;
  current?: boolean;
  onClick: () => void;
  onContextMenu?: ((event: MouseEvent) => void) | undefined;
}) {
  return <button type="button" className={`branch-item${active ? ' active' : ''}${current ? ' current' : ''}`} onClick={onClick} onContextMenu={onContextMenu}><span className="branch-icon">{icon}</span><span>{label}</span></button>;
}
