import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RepositoryPanel } from '@git4vsc/ui';
import '@git4vsc/ui/styles.css';
import type { CommitSummary, RepositoryStatus } from '@git4vsc/shared-types';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

interface ViewState {
  status: RepositoryStatus | null;
  commits: CommitSummary[];
  loading: boolean;
  error: string | null;
}

function App() {
  const [state, setState] = useState<ViewState>({ status: null, commits: [], loading: true, error: null });
  useEffect(() => {
    const listener = (event: MessageEvent<{ type: string; state: ViewState }>) => {
      if (event.data.type === 'snapshot') setState(event.data.state);
    };
    window.addEventListener('message', listener);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', listener);
  }, []);
  return <RepositoryPanel {...state} onRefresh={() => vscode.postMessage({ type: 'refresh' })} onLoadMore={() => vscode.postMessage({ type: 'loadMore' })} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

