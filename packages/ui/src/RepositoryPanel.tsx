import type { CommitSummary, RepositoryStatus } from '@git4vsc/shared-types';
import { CommitLog } from './CommitLog.js';

export interface RepositoryPanelProps {
  status: RepositoryStatus | null;
  commits: readonly CommitSummary[];
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRefresh?: (() => void) | undefined;
  onLoadMore?: (() => void) | undefined;
}

export function RepositoryPanel({ status, commits, loading, error, onRefresh, onLoadMore }: RepositoryPanelProps) {
  return (
    <main className="repository-panel">
      <header className="repository-header">
        <div>
          <strong>{status?.branch ?? 'Detached HEAD'}</strong>
          {status?.upstream && <span> ↔ {status.upstream} · ↑{status.ahead} ↓{status.behind}</span>}
        </div>
        <button type="button" onClick={onRefresh} disabled={loading}>Refresh</button>
      </header>
      {error && <div className="repository-error">{error}</div>}
      <CommitLog commits={commits} loading={loading} onLoadMore={onLoadMore} height={Math.max(240, window.innerHeight - 45)} />
    </main>
  );
}
