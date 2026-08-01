import { useEffect, useState, type PointerEvent } from 'react';
import type { CommitDetails, CommitFileChange, CommitSummary, GitRef, LogDateFilter, LogFilters, RepositoryStatus } from '@git4vsc/shared-types';
import { BranchSidebar, type RefAction, type RemoteAction } from './BranchSidebar.js';
import { CommitDetailsPane } from './CommitDetailsPane.js';
import { CommitLog, type CommitAction } from './CommitLog.js';
import type { CommitColumnWidths } from './commit-columns.js';
import { ContextMenu, type ContextMenuItem } from './ContextMenu.js';

export interface LogViewOptions {
  groupByDirectory: boolean;
  showDetails: boolean;
}

export interface RepositoryPanelProps {
  status: RepositoryStatus | null;
  commits: readonly CommitSummary[];
  activeRef: string | null;
  favoriteRefs?: readonly string[] | undefined;
  filters: LogFilters;
  users?: readonly string[] | undefined;
  selectedHash: string | null;
  details: CommitDetails | null;
  viewOptions?: LogViewOptions | undefined;
  hasMore?: boolean | undefined;
  loading?: boolean | undefined;
  detailsLoading?: boolean | undefined;
  error?: string | null | undefined;
  commitColumnWidths?: CommitColumnWidths | undefined;
  onRefresh?: (() => void) | undefined;
  onLoadMore?: (() => void) | undefined;
  onSelectRef?: ((ref: string | null) => void) | undefined;
  onFiltersChange?: ((filters: LogFilters) => void) | undefined;
  onPickPaths?: ((kind: 'files' | 'folder') => void) | undefined;
  onSelectCommit?: ((commit: CommitSummary) => void) | undefined;
  onOpenFile?: ((change: CommitFileChange) => void) | undefined;
  onRevertChanges?: ((changes: readonly CommitFileChange[]) => void) | undefined;
  onViewOptionsChange?: ((options: LogViewOptions) => void) | undefined;
  onCommitAction?: ((action: CommitAction, commit: CommitSummary) => void) | undefined;
  onRefAction?: ((action: RefAction, ref: GitRef | null) => void) | undefined;
  onRemoteAction?: ((action: RemoteAction, remote: string | null) => void) | undefined;
  onCommitColumnWidthsChange?: ((widths: CommitColumnWidths) => void) | undefined;
}

type FilterMenu = { type: 'branch' | 'user' | 'date' | 'paths'; x: number; y: number };

export function RepositoryPanel(props: RepositoryPanelProps) {
  const { status, commits, activeRef, favoriteRefs, filters, users = [], selectedHash, details, hasMore, loading, detailsLoading, error } = props;
  const viewOptions = props.viewOptions ?? { groupByDirectory: true, showDetails: true };
  const [searchDraft, setSearchDraft] = useState(filters.text);
  const [filterMenu, setFilterMenu] = useState<FilterMenu | null>(null);
  const [pathEditor, setPathEditor] = useState<{ x: number; y: number } | null>(null);
  const [leftWidth, setLeftWidth] = useState(210);
  const [rightWidth, setRightWidth] = useState(330);

  useEffect(() => setSearchDraft(filters.text), [filters.text]);
  useEffect(() => {
    const timer = setTimeout(() => { if (searchDraft !== filters.text) props.onFiltersChange?.({ ...filters, text: searchDraft.trim() }); }, 250);
    return () => clearTimeout(timer);
  }, [filters, props.onFiltersChange, searchDraft]);

  function startResize(side: 'left' | 'right', event: PointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = side === 'left' ? leftWidth : rightWidth;
    const move = (moveEvent: globalThis.PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = Math.max(170, Math.min(520, startWidth + (side === 'left' ? delta : -delta)));
      if (side === 'left') setLeftWidth(next); else setRightWidth(next);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  const activeLabel = activeRef === null ? 'All branches' : activeRef === 'HEAD' ? 'HEAD' : status?.refs.find(ref => ref.fullName === activeRef)?.name ?? activeRef;
  const openFilter = (type: FilterMenu['type'], element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setFilterMenu({ type, x: rect.left, y: rect.bottom + 2 });
  };
  const updateFilters = (patch: Partial<LogFilters>) => props.onFiltersChange?.({ ...filters, ...patch });
  const branchItems: ContextMenuItem[] = [
    { id: '', label: `${activeRef === null ? '✓ ' : ''}All branches` },
    { id: 'HEAD', label: `${activeRef === 'HEAD' ? '✓ ' : ''}HEAD` },
    { id: 'branch-separator', separator: true },
    ...(status?.refs.map(ref => ({ id: ref.fullName, label: `${activeRef === ref.fullName ? '✓ ' : ''}${ref.name}` })) ?? [])
  ];
  const userItems: ContextMenuItem[] = [
    { id: '', label: `${filters.user ? '' : '✓ '}All users` },
    { id: 'user-separator', separator: true },
    ...users.map(user => ({ id: user, label: `${filters.user === user ? '✓ ' : ''}${user}` }))
  ];
  const dateItems: ContextMenuItem[] = dateFilters.map(item => ({ id: item.id, label: `${filters.date === item.id ? '✓ ' : ''}${item.label}` }));
  const pathItems: ContextMenuItem[] = [
    { id: 'files', label: 'Select Files…' },
    { id: 'folder', label: 'Select Folder…' },
    { id: 'manual', label: 'Enter Paths…' },
    ...(filters.path ? [{ id: 'clear-separator', separator: true }, { id: 'clear', label: 'Clear Paths Filter' }] : [])
  ];
  const dateLabel = dateFilters.find(item => item.id === filters.date)?.label ?? 'Any time';

  return (
    <main className="repository-panel" style={{ gridTemplateColumns: `${leftWidth}px 3px minmax(320px, 1fr) 3px ${rightWidth}px` }}>
      <BranchSidebar status={status} activeRef={activeRef} favoriteRefs={favoriteRefs} onSelectRef={props.onSelectRef} onRefAction={props.onRefAction} onRemoteAction={props.onRemoteAction} />
      <div className="splitter" onPointerDown={event => startResize('left', event)} onDoubleClick={() => setLeftWidth(210)} />
      <section className="log-pane">
        <header className="log-toolbar">
          <div className="log-search"><span className="sidebar-search-icon" /><input value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="Text or hash" /></div>
          <div className="log-filter-strip">
            <FilterControl label="Branch" detail={activeRef === null ? '' : activeLabel} title={`Branch: ${activeLabel}`} onOpen={element => openFilter('branch', element)} onClear={() => props.onSelectRef?.(null)} />
            <FilterControl label="User" detail={filters.user} title={filters.user || 'All users'} onOpen={element => openFilter('user', element)} onClear={() => updateFilters({ user: '' })} />
            <FilterControl label="Date" detail={filters.date === 'all' ? '' : dateLabel} title={dateLabel} onOpen={element => openFilter('date', element)} onClear={() => updateFilters({ date: 'all' })} />
            <FilterControl label="Paths" detail={filters.path} title={filters.path || 'All paths'} onOpen={element => openFilter('paths', element)} onClear={() => updateFilters({ path: '' })} />
          </div>
          <span className="toolbar-spacer" />
          <button type="button" className="icon-button refresh-log" title="Refresh Log" aria-label="Refresh Log" onClick={props.onRefresh} disabled={loading}><RefreshIcon /></button>
        </header>
        {error && <div className="repository-error">{error}</div>}
        <CommitLog commits={commits} selectedHash={selectedHash} hasMore={hasMore} loading={loading} filtered={Boolean(filters.text || filters.user || filters.date !== 'all' || filters.path)} columnWidths={props.commitColumnWidths} onLoadMore={props.onLoadMore} onSelectCommit={props.onSelectCommit} onCommitAction={props.onCommitAction} onColumnWidthsChange={props.onCommitColumnWidthsChange} />
      </section>
      <div className="splitter" onPointerDown={event => startResize('right', event)} onDoubleClick={() => setRightWidth(330)} />
      <CommitDetailsPane details={details} loading={detailsLoading} groupByDirectory={viewOptions.groupByDirectory} showDetails={viewOptions.showDetails} onOptionsChange={props.onViewOptionsChange} onOpenFile={props.onOpenFile} onRevertChanges={props.onRevertChanges} />
      {filterMenu?.type === 'branch' && <ContextMenu x={filterMenu.x} y={filterMenu.y} items={branchItems} onClose={() => setFilterMenu(null)} onSelect={id => props.onSelectRef?.(id || null)} />}
      {filterMenu?.type === 'user' && <ContextMenu x={filterMenu.x} y={filterMenu.y} items={userItems} onClose={() => setFilterMenu(null)} onSelect={user => updateFilters({ user })} />}
      {filterMenu?.type === 'date' && <ContextMenu x={filterMenu.x} y={filterMenu.y} items={dateItems} onClose={() => setFilterMenu(null)} onSelect={date => updateFilters({ date: date as LogDateFilter })} />}
      {filterMenu?.type === 'paths' && <ContextMenu x={filterMenu.x} y={filterMenu.y} items={pathItems} onClose={() => setFilterMenu(null)} onSelect={id => {
        if (id === 'files' || id === 'folder') props.onPickPaths?.(id);
        else if (id === 'manual') setPathEditor({ x: filterMenu.x, y: filterMenu.y });
        else if (id === 'clear') updateFilters({ path: '' });
      }} />}
      {pathEditor && <PathFilter x={pathEditor.x} y={pathEditor.y} value={filters.path} onClose={() => setPathEditor(null)} onApply={path => updateFilters({ path })} />}
    </main>
  );
}

const dateFilters: readonly { id: LogDateFilter; label: string }[] = [
  { id: 'all', label: 'Any time' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' }
];

function FilterControl({ label, detail, title, onOpen, onClear }: { label: string; detail: string; title: string; onOpen(element: HTMLButtonElement): void; onClear(): void }) {
  if (!detail) return <button type="button" className="log-filter-button" title={title} onClick={event => onOpen(event.currentTarget)}>{label}<ChevronIcon /></button>;
  return <div className="log-filter-chip" title={`${label}: ${detail}`}>
    <button type="button" onClick={event => onOpen(event.currentTarget)}>{label}: {detail}</button>
    <button type="button" className="filter-chip-close" aria-label={`Clear ${label} filter`} onClick={onClear}>×</button>
  </div>;
}

function ChevronIcon() {
  return <svg className="filter-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>;
}

function PathFilter({ x, y, value, onApply, onClose }: { x: number; y: number; value: string; onApply(value: string): void; onClose(): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    const close = () => onClose();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', keydown); };
  }, [onClose]);
  const apply = () => { onApply(draft.trim()); onClose(); };
  return <div className="log-path-filter" style={{ left: Math.max(8, Math.min(x, window.innerWidth - 288)), top: y }} onPointerDown={event => event.stopPropagation()}>
    <input autoFocus value={draft} placeholder="Paths or globs, comma separated" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') apply(); }} />
    <div><button type="button" onClick={() => { onApply(''); onClose(); }}>Clear</button><button type="button" onClick={apply}>Apply</button></div>
  </div>;
}

function RefreshIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 5.7A5.5 5.5 0 0 0 3.7 3.8L2.3 5.2M2.8 10.3a5.5 5.5 0 0 0 9.5 1.9l1.4-1.4M2.3 2.5v2.7H5M13.7 13.5v-2.7H11" /></svg>;
}
