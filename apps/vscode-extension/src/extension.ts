import * as vscode from 'vscode';
import { RepositoryManager, type RepositoryController } from '@git4vsc/repo-state';
import { GitContentProvider, type GitResourceState, ScmRepositoryAdapter } from './scm-adapter.js';
import { LogPanel } from './log-panel.js';
import { RepositoryTree } from './repository-tree.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const manager = new RepositoryManager();
  const adapters: ScmRepositoryAdapter[] = [];
  const tree = new RepositoryTree(() => manager.all);
  const logPanel = new LogPanel(context, () => manager.all[0]);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('git4vsc.repositories', tree));
  context.subscriptions.push(logPanel, vscode.window.registerWebviewViewProvider('git4vsc.logView', logPanel, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('git4vsc', new GitContentProvider(() => manager.all)));

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    try {
      const repository = await manager.open(folder.uri.fsPath);
      const adapter = new ScmRepositoryAdapter(repository);
      adapters.push(adapter);
      context.subscriptions.push(adapter);
      watchRepository(context, repository, tree);
      repository.onDidChange(() => tree.refresh());
    } catch {
      // A workspace folder is not necessarily a Git repository.
    }
  }
  tree.refresh();
  logPanel.initialize(manager.all[0]);

  const selectedRepository = (value?: RepositoryController | GitResourceState): RepositoryController | undefined => {
    if (value && 'location' in value) return value;
    if (value && 'repository' in value) return value.repository;
    return manager.all[0];
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('git4vsc.refresh', async (value?: RepositoryController) => {
      const repositories = value ? [value] : manager.all;
      await Promise.all(repositories.map(repository => {
        repository.invalidate('status', 'log', 'refs');
        return repository.refresh();
      }));
    }),
    vscode.commands.registerCommand('git4vsc.stage', async (...states: GitResourceState[]) => {
      const repository = selectedRepository(states[0]);
      if (!repository) return;
      const paths = states.length ? states.map(state => state.path) : repository.snapshot.status?.changes.filter(change => change.index === null).map(change => change.path) ?? [];
      if (paths.length) await repository.stage(paths);
    }),
    vscode.commands.registerCommand('git4vsc.unstage', async (...states: GitResourceState[]) => {
      const repository = selectedRepository(states[0]);
      if (!repository) return;
      const paths = states.length ? states.map(state => state.path) : repository.snapshot.status?.changes.filter(change => change.index !== null).map(change => change.path) ?? [];
      if (paths.length) await repository.unstage(paths);
    }),
    vscode.commands.registerCommand('git4vsc.commit', async (value?: RepositoryController) => {
      const repository = selectedRepository(value);
      const adapter = repository && adapters.find(candidate => candidate.repository === repository);
      const message = adapter?.sourceControl.inputBox.value.trim();
      if (!repository || !adapter || !message) {
        void vscode.window.showWarningMessage('Enter a commit message in the Source Control input box.');
        return;
      }
      await vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl, title: 'Committing…' }, () => repository.commit(message));
      adapter.sourceControl.inputBox.value = '';
    }),
    vscode.commands.registerCommand('git4vsc.commitAll', async (value?: RepositoryController) => {
      const repository = selectedRepository(value);
      const adapter = repository && adapters.find(candidate => candidate.repository === repository);
      const message = adapter?.sourceControl.inputBox.value.trim();
      if (repository && message) await repository.commit(message, true);
    }),
    vscode.commands.registerCommand('git4vsc.openLog', (value?: RepositoryController | GitResourceState) => {
      const repository = selectedRepository(value);
      if (repository) logPanel.show(repository);
    }),
    vscode.commands.registerCommand('git4vsc.toggleLog', (value?: RepositoryController | GitResourceState) => {
      const repository = selectedRepository(value);
      if (repository) logPanel.toggle(repository);
    })
  );
}

function watchRepository(context: vscode.ExtensionContext, repository: RepositoryController, tree: RepositoryTree): void {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(repository.location.gitDir, '**/*'));
  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      repository.invalidate('status', 'log', 'refs');
      void repository.refresh().then(() => tree.refresh());
    }, 150);
  };
  watcher.onDidCreate(schedule);
  watcher.onDidChange(schedule);
  watcher.onDidDelete(schedule);
  context.subscriptions.push(watcher, { dispose: () => clearTimeout(timer) });
}

export function deactivate(): void {}
