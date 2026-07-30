import { useEffect, useState, type PointerEvent } from 'react';
import type { CommitDetails, CommitFileChange, CommitSummary, GitRef, RepositoryStatus } from '@git4vsc/shared-types';
import { BranchSidebar, type RefAction, type RemoteAction } from './BranchSidebar.js';
import { CommitDetailsPane } from './CommitDetailsPane.js';
import { CommitLog, type CommitAction } from './CommitLog.js';
import type { CommitColumnWidths } from './commit-columns.js';

export interface RepositoryPanelProps {
  status: RepositoryStatus | null;
  commits: readonly CommitSummary[];
  activeRef: string | null;
  favoriteRefs?: readonly string[] | undefined;
  search: string;
  selectedHash: string | null;
  details: CommitDetails | null;
  hasMore?: boolean | undefined;
  loading?: boolean | undefined;
  detailsLoading?: boolean | undefined;
  error?: string | null | undefined;
  commitColumnWidths?: CommitColumnWidths | undefined;
  onRefresh?: (() => void) | undefined;
  onLoadMore?: (() => void) | undefined;
  onSelectRef?: ((ref: string | null) => void) | undefined;
  onSearch?: ((text: string) => void) | undefined;
  onSelectCommit?: ((commit: CommitSummary) => void) | undefined;
  onOpenFile?: ((change: CommitFileChange) => void) | undefined;
  onCommitAction?: ((action: CommitAction, commit: CommitSummary) => void) | undefined;
  onRefAction?: ((action: RefAction, ref: GitRef | null) => void) | undefined;
  onRemoteAction?: ((action: RemoteAction, remote: string | null) => void) | undefined;
  onCommitColumnWidthsChange?: ((widths: CommitColumnWidths) => void) | undefined;
}

export function RepositoryPanel(props: RepositoryPanelProps) {
  const { status, commits, activeRef, favoriteRefs, search, selectedHash, details, hasMore, loading, detailsLoading, error } = props;
  const [searchDraft, setSearchDraft] = useState(search);
  const [leftWidth, setLeftWidth] = useState(210);
  const [rightWidth, setRightWidth] = useState(330);

  useEffect(() => setSearchDraft(search), [search]);
  useEffect(() => {
    const timer = setTimeout(() => { if (searchDraft !== search) props.onSearch?.(searchDraft.trim()); }, 250);
    return () => clearTimeout(timer);
  }, [props.onSearch, search, searchDraft]);

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
  return (
    <main className="repository-panel" style={{ gridTemplateColumns: `${leftWidth}px 3px minmax(320px, 1fr) 3px ${rightWidth}px` }}>
      <BranchSidebar status={status} activeRef={activeRef} favoriteRefs={favoriteRefs} onSelectRef={props.onSelectRef} onRefAction={props.onRefAction} onRemoteAction={props.onRemoteAction} />
      <div className="splitter" onPointerDown={event => startResize('left', event)} onDoubleClick={() => setLeftWidth(210)} />
      <section className="log-pane">
        <header className="log-toolbar">
          <div className="log-search"><span>⌕</span><input value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="Text or hash" /></div>
          <span className="active-filter" title={activeLabel}>⑂ {activeLabel}</span>
          <span className="toolbar-spacer" />
          <button type="button" className="icon-button" title="Refresh Log" onClick={props.onRefresh} disabled={loading}>↻</button>
        </header>
        {error && <div className="repository-error">{error}</div>}
        <CommitLog commits={commits} selectedHash={selectedHash} hasMore={hasMore} loading={loading} columnWidths={props.commitColumnWidths} onLoadMore={props.onLoadMore} onSelectCommit={props.onSelectCommit} onCommitAction={props.onCommitAction} onColumnWidthsChange={props.onCommitColumnWidthsChange} />
      </section>
      <div className="splitter" onPointerDown={event => startResize('right', event)} onDoubleClick={() => setRightWidth(330)} />
      <CommitDetailsPane details={details} loading={detailsLoading} onOpenFile={props.onOpenFile} />
    </main>
  );
}
