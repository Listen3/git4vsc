import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RepositoryPanel } from '@git4vsc/ui';
import '@git4vsc/ui/styles.css';
import type { CommitDetails, CommitFileChange, CommitSummary, GitRef, RepositoryStatus } from '@git4vsc/shared-types';
import type { CommitAction, RefAction } from '@git4vsc/ui';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

interface ViewState {
  status: RepositoryStatus | null;
  commits: CommitSummary[];
  activeRef: string | null;
  search: string;
  selectedHash: string | null;
  details: CommitDetails | null;
  hasMore: boolean;
  loading: boolean;
  detailsLoading: boolean;
  error: string | null;
}

function App() {
  const [state, setState] = useState<ViewState>({ status: null, commits: [], activeRef: null, search: '', selectedHash: null, details: null, hasMore: false, loading: true, detailsLoading: false, error: null });
  useEffect(() => {
    const listener = (event: MessageEvent<{ type: string; state: ViewState }>) => {
      if (event.data.type === 'snapshot') setState(event.data.state);
    };
    window.addEventListener('message', listener);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', listener);
  }, []);
  return <RepositoryPanel
    {...state}
    onRefresh={() => vscode.postMessage({ type: 'refresh' })}
    onLoadMore={() => vscode.postMessage({ type: 'loadMore' })}
    onSelectRef={(ref: string | null) => vscode.postMessage({ type: 'selectRef', ref })}
    onSearch={(text: string) => vscode.postMessage({ type: 'search', text })}
    onSelectCommit={(commit: CommitSummary) => vscode.postMessage({ type: 'selectCommit', hash: commit.hash })}
    onOpenFile={(change: CommitFileChange) => vscode.postMessage({ type: 'openCommitDiff', hash: state.selectedHash, change })}
    onCommitAction={(action: CommitAction, commit: CommitSummary) => vscode.postMessage({ type: 'commitAction', action, hash: commit.hash })}
    onRefAction={(action: RefAction, ref: GitRef | null) => vscode.postMessage({ type: 'refAction', action, fullName: ref?.fullName ?? null })}
  />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
