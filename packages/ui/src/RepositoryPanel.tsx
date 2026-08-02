import { useEffect, useState, type PointerEvent } from 'react';
import type { CommitDetails, CommitFileChange, CommitSummary, GitRef, LogDateFilter, LogFilters, RepositoryStatus } from '@git4vsc/shared-types';
import { BranchSidebar, type RefAction, type RemoteAction } from './BranchSidebar.js';
import { CommitDetailsPane, type CommitFileAction } from './CommitDetailsPane.js';
import { CommitLog, type CommitAction } from './CommitLog.js';
import { normalizeCommitColumnVisibility, type CommitColumnVisibility, type CommitColumnWidths } from './commit-columns.js';
import { ContextMenu, type ContextMenuItem } from './ContextMenu.js';
import { OperationActivity } from './OperationActivity.js';

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
  searchHistory?: readonly string[] | undefined;
  users?: readonly string[] | undefined;
  selectedHash: string | null;
  details: CommitDetails | null;
  viewOptions?: LogViewOptions | undefined;
  hasMore?: boolean | undefined;
  loading?: boolean | undefined;
  activity?: string | null | undefined;
  detailsLoading?: boolean | undefined;
  error?: string | null | undefined;
  commitColumnWidths?: CommitColumnWidths | undefined;
  commitColumnVisibility?: CommitColumnVisibility | undefined;
  onRefresh?: (() => void) | undefined;
  onLoadMore?: (() => void) | undefined;
  onSelectRef?: ((ref: string | null) => void) | undefined;
  onFiltersChange?: ((filters: LogFilters) => void) | undefined;
  onRememberSearch?: ((text: string) => void) | undefined;
  onPickPaths?: (() => void) | undefined;
  onSelectCommit?: ((commit: CommitSummary) => void) | undefined;
  onOpenFile?: ((change: CommitFileChange) => void) | undefined;
  onFileAction?: ((action: CommitFileAction, changes: readonly CommitFileChange[]) => void) | undefined;
  onViewOptionsChange?: ((options: LogViewOptions) => void) | undefined;
  onCommitAction?: ((action: CommitAction, commit: CommitSummary) => void) | undefined;
  onRefAction?: ((action: RefAction, ref: GitRef | null) => void) | undefined;
  onRemoteAction?: ((action: RemoteAction, remote: string | null) => void) | undefined;
  onCommitColumnWidthsChange?: ((widths: CommitColumnWidths) => void) | undefined;
  onCommitColumnVisibilityChange?: ((visibility: CommitColumnVisibility) => void) | undefined;
}

type FilterMenu = { type: 'branch' | 'user' | 'date' | 'paths'; x: number; y: number };

export function RepositoryPanel(props: RepositoryPanelProps) {
  const { status, commits, activeRef, favoriteRefs, filters, searchHistory = [], users = [], selectedHash, details, hasMore, loading, detailsLoading, error } = props;
  const viewOptions = props.viewOptions ?? { groupByDirectory: true, showDetails: true };
  const [searchDraft, setSearchDraft] = useState(filters.text);
  const [filterMenu, setFilterMenu] = useState<FilterMenu | null>(null);
  const [columnMenu, setColumnMenu] = useState<{ x: number; y: number } | null>(null);
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

  const activeLabel = activeRef === null ? 'All branches' : activeRef === 'HEAD' ? status?.branch ?? 'HEAD' : status?.refs.find(ref => ref.fullName === activeRef)?.name ?? activeRef;
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
    { id: 'select', label: 'Select…' },
    { id: 'manual', label: 'Enter Paths…' },
    ...(filters.path ? [{ id: 'clear-separator', separator: true }, { id: 'clear', label: 'Clear Paths Filter' }] : [])
  ];
  const columnVisibility = normalizeCommitColumnVisibility(props.commitColumnVisibility);
  const columnItems: ContextMenuItem[] = (['author', 'date', 'hash'] as const).map(column => ({
    id: column,
    label: `${columnVisibility[column] ? '✓ ' : '  '}${column[0]!.toUpperCase()}${column.slice(1)}`
  }));
  const dateLabel = dateFilters.find(item => item.id === filters.date)?.label ?? 'Any time';

  return (
    <main className="repository-panel" style={{ gridTemplateColumns: `${leftWidth}px 3px minmax(320px, 1fr) 3px ${rightWidth}px` }}>
      <BranchSidebar status={status} activeRef={activeRef} favoriteRefs={favoriteRefs} onSelectRef={props.onSelectRef} onRefAction={props.onRefAction} onRemoteAction={props.onRemoteAction} />
      <div className="splitter" onPointerDown={event => startResize('left', event)} onDoubleClick={() => setLeftWidth(210)} />
      <section className="log-pane">
        <OperationActivity label={props.activity} />
        <header className="log-toolbar">
          <LogSearch
            value={searchDraft}
            history={searchHistory}
            regex={filters.regex}
            caseSensitive={filters.caseSensitive}
            onChange={setSearchDraft}
            onApply={text => { setSearchDraft(text); updateFilters({ text: text.trim() }); }}
            onRemember={text => props.onRememberSearch?.(text)}
            onRegexChange={regex => updateFilters({ regex })}
            onCaseSensitiveChange={caseSensitive => updateFilters({ caseSensitive })}
          />
          <div className="log-filter-strip">
            <FilterControl label="Branch" detail={activeRef === null ? '' : activeLabel} title={`Branch: ${activeLabel}`} onOpen={element => openFilter('branch', element)} onClear={() => props.onSelectRef?.(null)} />
            <FilterControl label="User" detail={filters.user} title={filters.user || 'All users'} onOpen={element => openFilter('user', element)} onClear={() => updateFilters({ user: '' })} />
            <FilterControl label="Date" detail={filters.date === 'all' ? '' : dateLabel} title={dateLabel} onOpen={element => openFilter('date', element)} onClear={() => updateFilters({ date: 'all' })} />
            <FilterControl label="Paths" detail={filters.path} title={filters.path || 'All paths'} onOpen={element => openFilter('paths', element)} onClear={() => updateFilters({ path: '' })} />
          </div>
          <span className="toolbar-spacer" />
          <button type="button" className="icon-button" title="Choose Columns" aria-label="Choose Columns" onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setColumnMenu({ x: rect.right - 245, y: rect.bottom + 2 }); }}><EyeIcon /></button>
          <button type="button" className="icon-button refresh-log" title="Refresh Log" aria-label="Refresh Log" onClick={props.onRefresh} disabled={loading}><RefreshIcon /></button>
        </header>
        {error && <div className="repository-error">{error}</div>}
        <CommitLog commits={commits} selectedHash={selectedHash} hasMore={hasMore} loading={loading} filtered={Boolean(filters.text || filters.user || filters.date !== 'all' || filters.path)} columnWidths={props.commitColumnWidths} visibleColumns={columnVisibility} onLoadMore={props.onLoadMore} onSelectCommit={props.onSelectCommit} onCommitAction={props.onCommitAction} onColumnWidthsChange={props.onCommitColumnWidthsChange} />
      </section>
      <div className="splitter" onPointerDown={event => startResize('right', event)} onDoubleClick={() => setRightWidth(330)} />
      <CommitDetailsPane details={details} loading={detailsLoading} groupByDirectory={viewOptions.groupByDirectory} showDetails={viewOptions.showDetails} onOptionsChange={props.onViewOptionsChange} onOpenFile={props.onOpenFile} onFileAction={props.onFileAction} />
      {filterMenu?.type === 'branch' && <ContextMenu x={filterMenu.x} y={filterMenu.y} items={branchItems} onClose={() => setFilterMenu(null)} onSelect={id => props.onSelectRef?.(id || null)} />}
      {filterMenu?.type === 'user' && <ContextMenu x={filterMenu.x} y={filterMenu.y} items={userItems} onClose={() => setFilterMenu(null)} onSelect={user => updateFilters({ user })} />}
      {filterMenu?.type === 'date' && <ContextMenu x={filterMenu.x} y={filterMenu.y} items={dateItems} onClose={() => setFilterMenu(null)} onSelect={date => updateFilters({ date: date as LogDateFilter })} />}
      {filterMenu?.type === 'paths' && <ContextMenu x={filterMenu.x} y={filterMenu.y} items={pathItems} onClose={() => setFilterMenu(null)} onSelect={id => {
        if (id === 'select') props.onPickPaths?.();
        else if (id === 'manual') setPathEditor({ x: filterMenu.x, y: filterMenu.y });
        else if (id === 'clear') updateFilters({ path: '' });
      }} />}
      {columnMenu && <ContextMenu x={columnMenu.x} y={columnMenu.y} items={columnItems} dismissOnSelect={false} onClose={() => setColumnMenu(null)} onSelect={id => {
        const column = id as keyof CommitColumnVisibility;
        props.onCommitColumnVisibilityChange?.({ ...columnVisibility, [column]: !columnVisibility[column] });
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

function LogSearch({ value, history, regex, caseSensitive, onChange, onApply, onRemember, onRegexChange, onCaseSensitiveChange }: {
  value: string;
  history: readonly string[];
  regex: boolean;
  caseSensitive: boolean;
  onChange(value: string): void;
  onApply(value: string): void;
  onRemember(value: string): void;
  onRegexChange(value: boolean): void;
  onCaseSensitiveChange(value: boolean): void;
}) {
  const [focused, setFocused] = useState(false);
  const remember = () => { if (value.trim()) onRemember(value.trim()); };
  return <div className="log-search" onFocus={() => setFocused(true)} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setFocused(false);
      remember();
    }
  }}>
    <span className="sidebar-search-icon" />
    <input value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter') { onApply(value); remember(); setFocused(false); event.currentTarget.blur(); }
      else if (event.key === 'Escape') { setFocused(false); event.currentTarget.blur(); }
    }} placeholder="Text or hash" />
    {value && <button type="button" className="log-search-action log-search-clear" title="Clear" aria-label="Clear search" onClick={() => onApply('')}>×</button>}
    <button type="button" className={`log-search-action${regex ? ' active' : ''}`} title="Regex" aria-pressed={regex} onClick={() => onRegexChange(!regex)}>.*</button>
    <button type="button" className={`log-search-action log-search-case${caseSensitive ? ' active' : ''}`} title="Match Case" aria-pressed={caseSensitive} onClick={() => onCaseSensitiveChange(!caseSensitive)}>Cc</button>
    {focused && history.length > 0 && <div className="log-search-history">
      {history.map(item => <button type="button" key={item} title={item} onPointerDown={event => event.preventDefault()} onClick={() => { onApply(item); onRemember(item); setFocused(false); }}>{item}</button>)}
    </div>}
  </div>;
}

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

function EyeIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4Z" /><circle cx="8" cy="8" r="1.8" /></svg>;
}
