import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type UIEvent } from 'react';
import { layoutCommits } from '@git4vsc/git-graph';
import type { CommitSummary } from '@git4vsc/shared-types';
import { defaultCommitColumnWidths, normalizeCommitColumnVisibility, normalizeCommitColumnWidths, resizeCommitDetailColumn, responsiveCommitColumnWidth, type CommitColumnVisibility, type CommitColumnWidths, type CommitDetailColumn } from './commit-columns.js';
import { formatCommitTime, formatExactCommitTime } from './commit-date.js';
import { CommitGraph, type FilteredConnection } from './CommitGraph.js';
import { ContextMenu, type ContextMenuItem } from './ContextMenu.js';
import { OverlayScrollbar } from './OverlayScrollbar.js';

export type CommitAction = 'copyRevision' | 'copySubject' | 'createBranch' | 'createTag' | 'checkout' | 'compareLocal' | 'cherryPick' | 'revert' | 'reset';

export interface CommitLogProps {
  commits: readonly CommitSummary[];
  selectedHash?: string | null | undefined;
  hasMore?: boolean | undefined;
  loading?: boolean | undefined;
  filtered?: boolean | undefined;
  columnWidths?: CommitColumnWidths | undefined;
  visibleColumns?: CommitColumnVisibility | undefined;
  onLoadMore?: (() => void) | undefined;
  onSelectCommit?: ((commit: CommitSummary) => void) | undefined;
  onCommitAction?: ((action: CommitAction, commit: CommitSummary) => void) | undefined;
  onColumnWidthsChange?: ((widths: CommitColumnWidths) => void) | undefined;
}

const rowHeight = 25;
const overscan = 10;
const rowEndPadding = 12;

export function CommitLog({ commits, selectedHash, hasMore = false, loading = false, filtered = false, columnWidths: initialColumnWidths, visibleColumns: initialVisibleColumns, onLoadMore, onSelectCommit, onCommitAction, onColumnWidthsChange }: CommitLogProps) {
  const graph = useMemo(() => layoutCommits(commits), [commits]);
  const container = useRef<HTMLDivElement>(null);
  const previousCommits = useRef(commits);
  const previousSelectedHash = useRef(selectedHash);
  const widthsRef = useRef(normalizeCommitColumnWidths(initialColumnWidths));
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [height, setHeight] = useState(500);
  const [width, setWidth] = useState(0);
  const [columnWidths, setColumnWidths] = useState(widthsRef.current);
  const [menu, setMenu] = useState<{ x: number; y: number; commit: CommitSummary } | null>(null);
  const [clock, setClock] = useState(Date.now());
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(commits.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  const graphWidth = filtered ? 24 : Math.max(26, graph.maxLaneCount * 13 + 6);
  const visibleColumns = normalizeCommitColumnVisibility(initialVisibleColumns);
  const optionalColumns = (['author', 'date', 'hash'] as const).filter(column => visibleColumns[column]);
  const commitMinimum = graphWidth + 80;
  const commitWidth = width > 0
    ? responsiveCommitColumnWidth(columnWidths, visibleColumns, width, commitMinimum, rowEndPadding)
    : Math.max(columnWidths.commit, commitMinimum);
  const rowTemplate = [`${graphWidth}px`, `${commitWidth - graphWidth}px`, ...optionalColumns.map(column => `${columnWidths[column]}px`)].join(' ');
  const naturalTableWidth = commitWidth + optionalColumns.reduce((total, column) => total + columnWidths[column], 0) + rowEndPadding;
  const tableWidth = Math.max(width, naturalTableWidth);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(() => {
      setHeight(container.current?.clientHeight ?? 500);
      setWidth(container.current?.clientWidth ?? 0);
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    const element = container.current;
    const oldCommits = previousCommits.current;
    const oldSelectedHash = previousSelectedHash.current;
    previousCommits.current = commits;
    previousSelectedHash.current = selectedHash;
    if (!element || (oldCommits === commits && oldSelectedHash === selectedHash)) return;

    const firstVisible = Math.floor(element.scrollTop / rowHeight);
    const nextSelectedIndex = selectedHash ? commits.findIndex(commit => commit.hash === selectedHash) : -1;
    if (oldCommits === commits) {
      const selectedTop = nextSelectedIndex * rowHeight;
      if (nextSelectedIndex >= 0 && (selectedTop < element.scrollTop || selectedTop + rowHeight > element.scrollTop + element.clientHeight)) {
        element.scrollTop = Math.max(0, selectedTop - (element.clientHeight - rowHeight) / 2);
        setScrollTop(element.scrollTop);
      }
      return;
    }
    const selectedIndex = oldSelectedHash ? oldCommits.findIndex(commit => commit.hash === oldSelectedHash) : -1;
    const selectedVisible = selectedIndex >= firstVisible && selectedIndex * rowHeight < element.scrollTop + element.clientHeight;
    const anchorIndex = selectedVisible ? selectedIndex : firstVisible;
    const anchor = oldCommits[anchorIndex];
    const anchorOffset = anchorIndex * rowHeight - element.scrollTop;
    const nextAnchorIndex = anchor ? commits.findIndex(commit => commit.hash === anchor.hash) : -1;
    if (nextAnchorIndex >= 0) element.scrollTop = nextAnchorIndex * rowHeight - anchorOffset;
    else if (nextSelectedIndex >= 0) element.scrollTop = nextSelectedIndex * rowHeight;
    setScrollTop(element.scrollTop);
  }, [commits, selectedHash]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    setScrollTop(target.scrollTop);
    setScrollLeft(target.scrollLeft);
    if (hasMore && onLoadMore && !loading && target.scrollTop + target.clientHeight >= target.scrollHeight - rowHeight * 8) onLoadMore();
  }

  function startColumnResize(column: CommitDetailColumn, event: PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidths = { ...widthsRef.current, commit: commitWidth };
    const move = (moveEvent: globalThis.PointerEvent) => {
      const next = resizeCommitDetailColumn(startWidths, column, moveEvent.clientX - startX, graphWidth + 80);
      widthsRef.current = next;
      setColumnWidths(next);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      onColumnWidthsChange?.(widthsRef.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  function resetColumn(column: CommitDetailColumn) {
    const current = { ...widthsRef.current, commit: commitWidth };
    const next = resizeCommitDetailColumn(current, column, current[column] - defaultCommitColumnWidths[column], graphWidth + 80);
    widthsRef.current = next;
    setColumnWidths(next);
    onColumnWidthsChange?.(next);
  }

  let resizerLeft = commitWidth;
  const resizers: [CommitDetailColumn, string, number][] = [];
  for (const column of optionalColumns) {
    resizers.push([column, column[0]!.toUpperCase() + column.slice(1), resizerLeft]);
    resizerLeft += columnWidths[column];
  }

  function navigate(event: KeyboardEvent, index: number) {
    const next = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : -1;
    if (next < 0 || next >= commits.length) return;
    event.preventDefault();
    const commit = commits[next];
    if (!commit) return;
    onSelectCommit?.(commit);
    container.current?.scrollTo({ top: Math.max(0, next * rowHeight - height / 2), behavior: 'smooth' });
  }

  const menuItems: ContextMenuItem[] = [
    { id: 'copyRevision', label: 'Copy Revision Number' },
    { id: 'copySubject', label: 'Copy Commit Message' },
    { id: 'separator-1', separator: true },
    { id: 'createBranch', label: 'New Branch…' },
    { id: 'createTag', label: 'New Tag…' },
    { id: 'checkout', label: 'Checkout Revision…' },
    { id: 'compareLocal', label: 'Compare with Local' },
    { id: 'separator-2', separator: true },
    { id: 'cherryPick', label: 'Cherry-Pick…' },
    { id: 'reset', label: 'Reset Current Branch to Here…' },
    { id: 'revert', label: 'Revert Commit…' }
  ];

  return (
    <div className="commit-table">
      <div className="commit-column-guides">
        {resizers.map(([column, label, left]) => <span className="commit-column-resizer" key={column} style={{ left: left - scrollLeft - 3 }} title={`Resize ${label} column; double-click to reset`} onPointerDown={event => startColumnResize(column, event)} onDoubleClick={() => resetColumn(column)} />)}
      </div>
      <div ref={container} className="commit-log" onScroll={handleScroll} role="table" aria-label="Git commit log">
        <div className="commit-log-spacer" style={{ height: commits.length * rowHeight, minWidth: tableWidth }}>
          {commits.slice(first, last).map((commit, offset) => {
            const index = first + offset;
            const row = graph.rows[index];
            if (!row) return null;
            const rowGraphWidth = filtered ? graphWidth : Math.max(26, row.laneCount * 13 + 6);
            return (
              <button
                type="button"
                role="row"
                aria-selected={selectedHash === commit.hash}
                className={`commit-row${selectedHash === commit.hash ? ' selected' : ''}`}
                key={commit.hash}
                style={{ height: rowHeight, top: index * rowHeight, gridTemplateColumns: rowTemplate, minWidth: tableWidth }}
                onClick={() => onSelectCommit?.(commit)}
                onContextMenu={event => { event.preventDefault(); onSelectCommit?.(commit); setMenu({ x: event.clientX, y: event.clientY, commit }); }}
                onKeyDown={event => navigate(event, index)}
              >
                <CommitGraph row={row} width={graphWidth} {...(filtered ? { filtered: filteredConnections(commits, index) } : {})} />
                <span className="commit-main" style={{ marginLeft: rowGraphWidth - graphWidth, width: `calc(100% + ${graphWidth - rowGraphWidth}px)` }}><span className="commit-subject">{commit.subject}</span><span className="commit-refs">{commit.refs.map(ref => <span className={`commit-ref commit-ref-${ref.type}`} key={ref.fullName}>{ref.name}</span>)}</span></span>
                {visibleColumns.author && <span className="commit-author">{commit.authorName}</span>}
                {visibleColumns.date && <time title={formatExactCommitTime(commit.authorTime)}>{formatCommitTime(commit.authorTime, clock)}</time>}
                {visibleColumns.hash && <code>{commit.hash.slice(0, 8)}</code>}
              </button>
            );
          })}
        </div>
        {loading && commits.length === 0 && <div className="commit-loading">Loading…</div>}
        {!loading && commits.length === 0 && <div className="commit-empty">No commits match the current filters.</div>}
      </div>
      <OverlayScrollbar targetRef={container} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} onSelect={id => onCommitAction?.(id as CommitAction, menu.commit)} />}
    </div>
  );
}

export function filteredConnections(commits: readonly CommitSummary[], index: number): { top: FilteredConnection; bottom: FilteredConnection } {
  const current = commits[index];
  const previous = commits[index - 1];
  const next = commits[index + 1];
  return {
    top: previous ? previous.parents.includes(current?.hash ?? '') ? 'solid' : 'dashed' : 'none',
    bottom: next ? current?.parents.includes(next.hash) ? 'solid' : 'dashed' : 'none'
  };
}
