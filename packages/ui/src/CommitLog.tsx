import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type UIEvent } from 'react';
import { layoutCommits } from '@git4vsc/git-graph';
import type { CommitSummary } from '@git4vsc/shared-types';
import { defaultCommitColumnWidths, normalizeCommitColumnWidths, type CommitColumn, type CommitColumnWidths } from './commit-columns.js';
import { CommitGraph } from './CommitGraph.js';
import { ContextMenu, type ContextMenuItem } from './ContextMenu.js';

export type CommitAction = 'copyRevision' | 'copySubject' | 'createBranch' | 'createTag' | 'checkout' | 'compareLocal' | 'cherryPick' | 'revert' | 'reset';

export interface CommitLogProps {
  commits: readonly CommitSummary[];
  selectedHash?: string | null | undefined;
  hasMore?: boolean | undefined;
  loading?: boolean | undefined;
  columnWidths?: CommitColumnWidths | undefined;
  onLoadMore?: (() => void) | undefined;
  onSelectCommit?: ((commit: CommitSummary) => void) | undefined;
  onCommitAction?: ((action: CommitAction, commit: CommitSummary) => void) | undefined;
  onColumnWidthsChange?: ((widths: CommitColumnWidths) => void) | undefined;
}

const rowHeight = 25;
const overscan = 10;

export function CommitLog({ commits, selectedHash, hasMore = false, loading = false, columnWidths: initialColumnWidths, onLoadMore, onSelectCommit, onCommitAction, onColumnWidthsChange }: CommitLogProps) {
  const graph = useMemo(() => layoutCommits(commits), [commits]);
  const container = useRef<HTMLDivElement>(null);
  const widthsRef = useRef(normalizeCommitColumnWidths(initialColumnWidths));
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [height, setHeight] = useState(500);
  const [columnWidths, setColumnWidths] = useState(widthsRef.current);
  const [menu, setMenu] = useState<{ x: number; y: number; commit: CommitSummary } | null>(null);
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(commits.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  const graphWidth = Math.max(32, graph.maxLaneCount * 16 + 8);
  const commitWidth = Math.max(columnWidths.commit, graphWidth + 80);
  const columnTemplate = `${commitWidth}px ${columnWidths.author}px ${columnWidths.date}px ${columnWidths.hash}px`;
  const rowTemplate = `${graphWidth}px ${commitWidth - graphWidth}px ${columnWidths.author}px ${columnWidths.date}px ${columnWidths.hash}px`;
  const tableWidth = commitWidth + columnWidths.author + columnWidths.date + columnWidths.hash + 6;

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setHeight(entries[0]?.contentRect.height ?? 500));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    setScrollTop(target.scrollTop);
    setScrollLeft(target.scrollLeft);
    if (hasMore && onLoadMore && !loading && target.scrollTop + target.clientHeight >= target.scrollHeight - rowHeight * 8) onLoadMore();
  }

  function startColumnResize(column: CommitColumn, event: PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthsRef.current[column];
    const move = (moveEvent: globalThis.PointerEvent) => {
      const next = normalizeCommitColumnWidths({ ...widthsRef.current, [column]: startWidth + moveEvent.clientX - startX });
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

  function resetColumn(column: CommitColumn) {
    const next = { ...widthsRef.current, [column]: defaultCommitColumnWidths[column] };
    widthsRef.current = next;
    setColumnWidths(next);
    onColumnWidthsChange?.(next);
  }

  const headers: readonly [CommitColumn, string][] = [['commit', 'Commit'], ['author', 'Author'], ['date', 'Date'], ['hash', 'Hash']];

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
      <div className="commit-columns" style={{ gridTemplateColumns: columnTemplate, minWidth: tableWidth, transform: `translateX(${-scrollLeft}px)` }}>
        {headers.map(([column, label]) => <div className="commit-column" key={column}><span>{label}</span><span className="commit-column-resizer" title={`Resize ${label} column; double-click to reset`} onPointerDown={event => startColumnResize(column, event)} onDoubleClick={() => resetColumn(column)} /></div>)}
      </div>
      <div ref={container} className="commit-log" onScroll={handleScroll} role="table" aria-label="Git commit log">
        <div className="commit-log-spacer" style={{ height: commits.length * rowHeight, minWidth: tableWidth }}>
          {commits.slice(first, last).map((commit, offset) => {
            const index = first + offset;
            const row = graph.rows[index];
            if (!row) return null;
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
                <CommitGraph row={row} width={graphWidth} />
                <span className="commit-main"><span className="commit-subject">{commit.subject}</span><span className="commit-refs">{commit.refs.map(ref => <span className={`commit-ref commit-ref-${ref.type}`} key={ref.fullName}>{ref.name}</span>)}</span></span>
                <span className="commit-author">{commit.authorName}</span>
                <time>{new Date(commit.authorTime * 1000).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                <code>{commit.hash.slice(0, 8)}</code>
              </button>
            );
          })}
        </div>
        {loading && <div className="commit-loading">Loading…</div>}
        {!loading && commits.length === 0 && <div className="commit-empty">No commits match the current filters.</div>}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} onSelect={id => onCommitAction?.(id as CommitAction, menu.commit)} />}
    </div>
  );
}
