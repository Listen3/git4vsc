import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogHost, RepositoryPanel } from '@git4vsc/ui';
import '@git4vsc/ui/styles.css';
import type { CommitDetails, CommitFileChange, CommitSummary, GitRef, LogFilters, RepositoryStatus, WebviewDialogRequest } from '@git4vsc/shared-types';
import type { CommitAction, CommitColumnWidths, LogViewOptions, RefAction, RemoteAction } from '@git4vsc/ui';
import { CommitApp } from './commit-app.js';

interface PersistedWebviewState {
  commitColumnWidths?: CommitColumnWidths;
  viewOptions?: LogViewOptions;
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
  filters: LogFilters;
  users: string[];
  selectedHash: string | null;
  details: CommitDetails | null;
  hasMore: boolean;
  loading: boolean;
  detailsLoading: boolean;
  error: string | null;
}

function LogApp() {
  const [state, setState] = useState<ViewState>({ status: null, commits: [], activeRef: null, favoriteRefs: [], filters: { text: '', user: '', date: 'all', path: '' }, users: [], selectedHash: null, details: null, hasMore: false, loading: true, detailsLoading: false, error: null });
  const [commitColumnWidths, setCommitColumnWidths] = useState(restoredState?.commitColumnWidths);
  const [viewOptions, setViewOptions] = useState<LogViewOptions>(restoredState?.viewOptions ?? { groupByDirectory: true, showDetails: true });
  const [dialog, setDialog] = useState<WebviewDialogRequest | null>(null);
  useEffect(() => {
    const listener = (event: MessageEvent<{ type: string; state: ViewState; dialog?: WebviewDialogRequest }>) => {
      if (event.data.type === 'snapshot') setState(event.data.state);
      else if (event.data.type === 'dialog:open' && event.data.dialog) setDialog(event.data.dialog);
    };
    window.addEventListener('message', listener);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', listener);
  }, []);
  function saveCommitColumnWidths(widths: CommitColumnWidths) {
    setCommitColumnWidths(widths);
    vscode.setState({ ...vscode.getState(), commitColumnWidths: widths });
  }
  function saveViewOptions(options: LogViewOptions) {
    setViewOptions(options);
    vscode.setState({ ...vscode.getState(), viewOptions: options });
  }
  return <><RepositoryPanel
    {...state}
    commitColumnWidths={commitColumnWidths}
    viewOptions={viewOptions}
    onRefresh={() => vscode.postMessage({ type: 'refresh' })}
    onLoadMore={() => vscode.postMessage({ type: 'loadMore' })}
    onSelectRef={(ref: string | null) => vscode.postMessage({ type: 'selectRef', ref })}
    onFiltersChange={(filters: LogFilters) => vscode.postMessage({ type: 'filters', filters })}
    onPickPaths={kind => vscode.postMessage({ type: 'pickPaths', kind })}
    onSelectCommit={(commit: CommitSummary) => vscode.postMessage({ type: 'selectCommit', hash: commit.hash })}
    onOpenFile={(change: CommitFileChange) => vscode.postMessage({ type: 'openCommitDiff', hash: state.selectedHash, change })}
    onRevertChanges={changes => vscode.postMessage({ type: 'revertCommitChanges', hash: state.selectedHash, paths: changes.map(change => change.path) })}
    onViewOptionsChange={saveViewOptions}
    onCommitAction={(action: CommitAction, commit: CommitSummary) => vscode.postMessage({ type: 'commitAction', action, hash: commit.hash })}
    onRefAction={(action: RefAction, ref: GitRef | null) => vscode.postMessage({ type: 'refAction', action, fullName: ref?.fullName ?? null })}
    onRemoteAction={(action: RemoteAction, remote: string | null) => vscode.postMessage({ type: 'remoteAction', action, remote })}
    onCommitColumnWidthsChange={saveCommitColumnWidths}
  /><DialogHost dialog={dialog} onResolve={value => {
    if (dialog) vscode.postMessage({ type: 'dialog:result', id: dialog.id, value });
    setDialog(null);
  }} /></>;
}

const app = document.body.dataset.view === 'commit'
  ? <CommitApp postMessage={message => vscode.postMessage(message)} />
  : <LogApp />;

createRoot(document.getElementById('root')!).render(<StrictMode>{app}</StrictMode>);
