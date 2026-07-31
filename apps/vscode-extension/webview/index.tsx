import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RepositoryPanel } from '@git4vsc/ui';
import '@git4vsc/ui/styles.css';
import type { CommitDetails, CommitFileChange, CommitSummary, GitRef, RepositoryStatus } from '@git4vsc/shared-types';
import type { CommitAction, CommitColumnWidths, RefAction, RemoteAction } from '@git4vsc/ui';
import { CommitApp } from './commit-app.js';

interface PersistedWebviewState {
  commitColumnWidths?: CommitColumnWidths;
}

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): PersistedWebviewState | undefined;
  setState(state: PersistedWebviewState): void;
};
const vscode = acquireVsCodeApi();
const restoredState = vscode.getState();

interface ViewState {
  status: RepositoryStatus | null;
  commits: CommitSummary[];
  activeRef: string | null;
  favoriteRefs: string[];
  search: string;
  selectedHash: string | null;
  details: CommitDetails | null;
  hasMore: boolean;
  loading: boolean;
  detailsLoading: boolean;
  error: string | null;
}

function LogApp() {
  const [state, setState] = useState<ViewState>({ status: null, commits: [], activeRef: null, favoriteRefs: [], search: '', selectedHash: null, details: null, hasMore: false, loading: true, detailsLoading: false, error: null });
  const [commitColumnWidths, setCommitColumnWidths] = useState(restoredState?.commitColumnWidths);
  useEffect(() => {
    const listener = (event: MessageEvent<{ type: string; state: ViewState }>) => {
      if (event.data.type === 'snapshot') setState(event.data.state);
    };
    window.addEventListener('message', listener);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', listener);
  }, []);
  function saveCommitColumnWidths(widths: CommitColumnWidths) {
    setCommitColumnWidths(widths);
    vscode.setState({ ...vscode.getState(), commitColumnWidths: widths });
  }
  return <RepositoryPanel
    {...state}
    commitColumnWidths={commitColumnWidths}
    onRefresh={() => vscode.postMessage({ type: 'refresh' })}
    onLoadMore={() => vscode.postMessage({ type: 'loadMore' })}
    onSelectRef={(ref: string | null) => vscode.postMessage({ type: 'selectRef', ref })}
    onSearch={(text: string) => vscode.postMessage({ type: 'search', text })}
    onSelectCommit={(commit: CommitSummary) => vscode.postMessage({ type: 'selectCommit', hash: commit.hash })}
    onOpenFile={(change: CommitFileChange) => vscode.postMessage({ type: 'openCommitDiff', hash: state.selectedHash, change })}
    onCommitAction={(action: CommitAction, commit: CommitSummary) => vscode.postMessage({ type: 'commitAction', action, hash: commit.hash })}
    onRefAction={(action: RefAction, ref: GitRef | null) => vscode.postMessage({ type: 'refAction', action, fullName: ref?.fullName ?? null })}
    onRemoteAction={(action: RemoteAction, remote: string | null) => vscode.postMessage({ type: 'remoteAction', action, remote })}
    onCommitColumnWidthsChange={saveCommitColumnWidths}
  />;
}

const app = document.body.dataset.view === 'commit'
  ? <CommitApp postMessage={message => vscode.postMessage(message)} />
  : <LogApp />;

createRoot(document.getElementById('root')!).render(<StrictMode>{app}</StrictMode>);
