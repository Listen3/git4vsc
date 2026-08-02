import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogHost, RepositoryPanel, updatePathTreeEntries } from '@git4vsc/ui';
import '@git4vsc/ui/styles.css';
import type { CommitDetails, CommitFileChange, CommitSummary, GitRef, LogFilters, PathTreeEntry, RepositoryStatus, WebviewDialogRequest } from '@git4vsc/shared-types';
import type { CommitAction, CommitColumnVisibility, CommitColumnWidths, CommitFileAction, LogViewOptions, RefAction, RemoteAction } from '@git4vsc/ui';
import { CommitApp } from './commit-app.js';
import { SettingsApp } from './settings-app.js';

interface PersistedWebviewState {
  commitColumnWidths?: CommitColumnWidths;
  commitColumnVisibility?: CommitColumnVisibility;
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
  searchHistory: string[];
  users: string[];
  selectedHash: string | null;
  details: CommitDetails | null;
  hasMore: boolean;
  loading: boolean;
  activity: string | null;
  detailsLoading: boolean;
  error: string | null;
}

function LogApp() {
  const [state, setState] = useState<ViewState>({ status: null, commits: [], activeRef: 'HEAD', favoriteRefs: [], filters: { text: '', regex: false, caseSensitive: false, user: '', date: 'all', path: '' }, searchHistory: [], users: [], selectedHash: null, details: null, hasMore: false, loading: true, activity: 'Refreshing…', detailsLoading: false, error: null });
  const [commitColumnWidths, setCommitColumnWidths] = useState(restoredState?.commitColumnWidths);
  const [commitColumnVisibility, setCommitColumnVisibility] = useState(restoredState?.commitColumnVisibility);
  const [viewOptions, setViewOptions] = useState<LogViewOptions>(restoredState?.viewOptions ?? { groupByDirectory: true, showDetails: true });
  const [dialog, setDialog] = useState<WebviewDialogRequest | null>(null);
  useEffect(() => {
    const listener = (event: MessageEvent<{ type: string; state: ViewState; dialog?: WebviewDialogRequest; id?: number; path?: string; entries?: PathTreeEntry[] }>) => {
      if (event.data.type === 'snapshot') setState(event.data.state);
      else if (event.data.type === 'dialog:open' && event.data.dialog) setDialog(event.data.dialog);
      else if (event.data.type === 'dialog:pathChildren' && typeof event.data.id === 'number' && typeof event.data.path === 'string' && event.data.entries) {
        setDialog(current => current?.kind === 'path-tree' && current.id === event.data.id
          ? { ...current, entries: updatePathTreeEntries(current.entries, event.data.path!, event.data.entries!) }
          : current);
      }
    };
    window.addEventListener('message', listener);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', listener);
  }, []);
  function saveCommitColumnWidths(widths: CommitColumnWidths) {
    setCommitColumnWidths(widths);
    vscode.setState({ ...vscode.getState(), commitColumnWidths: widths });
  }
  function saveCommitColumnVisibility(visibility: CommitColumnVisibility) {
    setCommitColumnVisibility(visibility);
    vscode.setState({ ...vscode.getState(), commitColumnVisibility: visibility });
  }
  function saveViewOptions(options: LogViewOptions) {
    setViewOptions(options);
    vscode.setState({ ...vscode.getState(), viewOptions: options });
  }
  return <><RepositoryPanel
    {...state}
    commitColumnWidths={commitColumnWidths}
    commitColumnVisibility={commitColumnVisibility}
    viewOptions={viewOptions}
    onRefresh={() => vscode.postMessage({ type: 'refresh' })}
    onLoadMore={() => vscode.postMessage({ type: 'loadMore' })}
    onSelectRef={(ref: string | null) => vscode.postMessage({ type: 'selectRef', ref })}
    onFiltersChange={(filters: LogFilters) => vscode.postMessage({ type: 'filters', filters })}
    onRememberSearch={(text: string) => vscode.postMessage({ type: 'rememberSearch', text })}
    onPickPaths={() => vscode.postMessage({ type: 'pickPaths', kind: 'paths' })}
    onSelectCommit={(commit: CommitSummary) => vscode.postMessage({ type: 'selectCommit', hash: commit.hash })}
    onOpenFile={(change: CommitFileChange) => vscode.postMessage({ type: 'openCommitDiff', hash: state.selectedHash, change })}
    onFileAction={(action: CommitFileAction, changes) => vscode.postMessage({ type: 'commitFileAction', action, hash: state.selectedHash, paths: changes.map(change => change.path) })}
    onViewOptionsChange={saveViewOptions}
    onCommitAction={(action: CommitAction, commit: CommitSummary) => vscode.postMessage({ type: 'commitAction', action, hash: commit.hash })}
    onRefAction={(action: RefAction, ref: GitRef | null) => vscode.postMessage({ type: 'refAction', action, fullName: ref?.fullName ?? null })}
    onRemoteAction={(action: RemoteAction, remote: string | null) => vscode.postMessage({ type: 'remoteAction', action, remote })}
    onCommitColumnWidthsChange={saveCommitColumnWidths}
    onCommitColumnVisibilityChange={saveCommitColumnVisibility}
  /><DialogHost dialog={dialog} onResolve={value => {
    if (dialog) vscode.postMessage({ type: 'dialog:result', id: dialog.id, value });
    setDialog(null);
  }} onExpandPath={(id, path) => vscode.postMessage({ type: 'dialog:pathChildren', id, path })} /></>;
}

const app = document.body.dataset.view === 'commit'
  ? <CommitApp postMessage={message => vscode.postMessage(message)} />
  : document.body.dataset.view === 'settings'
    ? <SettingsApp postMessage={message => vscode.postMessage(message)} />
    : <LogApp />;

createRoot(document.getElementById('root')!).render(<StrictMode>{app}</StrictMode>);
