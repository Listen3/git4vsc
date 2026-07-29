import { useMemo, useState, type UIEvent } from 'react';
import { layoutCommits } from '@git4vsc/git-graph';
import type { CommitSummary } from '@git4vsc/shared-types';
import { CommitGraph } from './CommitGraph.js';

export interface CommitLogProps {
  commits: readonly CommitSummary[];
  height?: number | undefined;
  loading?: boolean | undefined;
  onLoadMore?: (() => void) | undefined;
  onSelectCommit?: ((commit: CommitSummary) => void) | undefined;
}

const rowHeight = 28;
const overscan = 10;

export function CommitLog({ commits, height = 520, loading = false, onLoadMore, onSelectCommit }: CommitLogProps) {
  const graph = useMemo(() => layoutCommits(commits), [commits]);
  const [scrollTop, setScrollTop] = useState(0);
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(commits.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  const graphWidth = Math.max(32, graph.maxLaneCount * 16 + 8);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    setScrollTop(target.scrollTop);
    if (onLoadMore && !loading && target.scrollTop + target.clientHeight >= target.scrollHeight - rowHeight * 8) onLoadMore();
  }

  return (
    <div className="commit-log" style={{ height }} onScroll={handleScroll} role="table" aria-label="Git commit log">
      <div className="commit-log-spacer" style={{ height: commits.length * rowHeight }}>
        {commits.slice(first, last).map((commit, offset) => {
          const index = first + offset;
          const row = graph.rows[index];
          if (!row) return null;
          return (
            <button
              type="button"
              role="row"
              className="commit-row"
              key={commit.hash}
              style={{ height: rowHeight, top: index * rowHeight }}
              onClick={() => onSelectCommit?.(commit)}
            >
              <CommitGraph row={row} width={graphWidth} />
              <span className="commit-subject">{commit.subject}</span>
              <span className="commit-refs">
                {commit.refs.map(ref => <span className={`commit-ref commit-ref-${ref.type}`} key={ref.fullName}>{ref.name}</span>)}
              </span>
              <span className="commit-author">{commit.authorName}</span>
              <time>{new Date(commit.authorTime * 1000).toLocaleDateString()}</time>
              <code>{commit.hash.slice(0, 8)}</code>
            </button>
          );
        })}
      </div>
      {loading && <div className="commit-loading">Loading…</div>}
    </div>
  );
}
