import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RepositoryPanel } from '@git4vsc/ui';
import '@git4vsc/ui/styles.css';
import type { CommitSummary, RepositoryStatus } from '@git4vsc/shared-types';
import './utools.css';

function App() {
  const [root, setRoot] = useState('');
  const [status, setStatus] = useState<RepositoryStatus | null>(null);
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function perform(action: () => Promise<{ status: RepositoryStatus | null; commits: CommitSummary[]; error: string | null }>) {
    setLoading(true);
    try {
      const snapshot = await action();
      setStatus(snapshot.status);
      setCommits(snapshot.commits);
      setError(snapshot.error);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function choose() {
    const path = await window.git4vsc.chooseRepository();
    if (!path) return;
    setRoot(path);
    await perform(() => window.git4vsc.open(path));
  }

  if (!status) {
    return <main className="utools-welcome"><h1>Git4VSC</h1><p>选择一个本机 Git 仓库开始。</p><button type="button" onClick={choose}>打开仓库</button>{error && <p className="repository-error">{error}</p>}</main>;
  }

  const unstaged = status.changes.filter(change => change.index === null).map(change => change.path);
  return <div className="utools-shell">
    <aside>
      <button type="button" onClick={choose}>切换仓库</button>
      <h3>Changes ({status.changes.length})</h3>
      <ul>{status.changes.map(change => <li key={`${change.path}-${change.index}-${change.workingTree}`}>{change.path}</li>)}</ul>
      <button type="button" disabled={!unstaged.length || loading} onClick={() => perform(() => window.git4vsc.stage(root, unstaged))}>全部暂存</button>
      <textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="提交说明" />
      <button type="button" disabled={!message.trim() || loading} onClick={() => perform(async () => { const result = await window.git4vsc.commit(root, message, false); setMessage(''); return result; })}>提交已暂存更改</button>
    </aside>
    <RepositoryPanel status={status} commits={commits} loading={loading} error={error} onRefresh={() => perform(() => window.git4vsc.refresh(root))} onLoadMore={() => perform(() => window.git4vsc.loadMore(root))} />
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);

