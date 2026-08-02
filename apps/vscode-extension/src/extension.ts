import * as vscode from 'vscode';
import { RepositoryManager, type RepositoryController } from '@git4vsc/repo-state';
import { BranchMenu } from './branch-menu.js';
import { GitContentProvider, type GitResourceState, ScmRepositoryAdapter } from './scm-adapter.js';
import { ConflictResolver } from './conflict-resolver.js';
import { ConflictTree } from './conflict-tree.js';
import { CommitView, stagedChanges } from './commit-view.js';
import { LogPanel } from './log-panel.js';
import { notifyCommitResult } from './operation-notifications.js';
import { operationActivity } from './repository-status.js';
import { SettingsPanel } from './settings-panel.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const manager = new RepositoryManager();
  const adapters: ScmRepositoryAdapter[] = [];
  const conflictTree = new ConflictTree(() => manager.all);
  const conflictResolver = new ConflictResolver(() => conflictTree.refresh());
  const commitRepository = async (repository: RepositoryController | undefined, message: string | undefined, all = false, paths?: readonly string[]): Promise<boolean> => {
    if (repository?.snapshot.status?.changes.some(change => change.conflict)) {
      void vscode.window.showWarningMessage('Resolve all merge conflicts before committing.');
      await conflictResolver.start(repository);
      return false;
    }
    if (!repository || !message?.trim()) {
      void vscode.window.showWarningMessage('Enter a commit message.');
      return false;
    }
    if (!all && paths === undefined && !stagedChanges(repository.snapshot.status?.changes ?? []).length) {
      void vscode.window.showWarningMessage('Stage at least one change before committing.');
      return false;
    }
    if (paths?.length === 0) {
      void vscode.window.showWarningMessage('Select at least one change before committing.');
      return false;
    }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl, title: 'Committing…' }, () => paths
      ? repository.commitPaths(message.trim(), paths)
      : repository.commit(message.trim(), all));
    notifyCommitResult(repository.snapshot.status?.head ?? null, message.trim());
    const adapter = adapters.find(candidate => candidate.repository === repository);
    if (adapter) adapter.sourceControl.inputBox.value = '';
    return true;
  };
  const commitView = new CommitView(context, () => manager.all, { commit: (repository, message, paths) => commitRepository(repository, message, false, paths) });
  const previewPush = (repository: RepositoryController, branch: string, remote: string, upstream?: string) => commitView.previewPush(repository, branch, remote, upstream);
  const logPanel = new LogPanel(context, () => manager.all[0], previewPush);
  const settingsPanel = new SettingsPanel(context);
  const branchMenu = new BranchMenu(previewPush);
  context.subscriptions.push(commitView, settingsPanel, vscode.window.registerWebviewViewProvider('git4vsc.repositories', commitView, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(conflictResolver, vscode.window.registerTreeDataProvider('git4vsc.conflicts', conflictTree));
  context.subscriptions.push(logPanel, vscode.window.registerWebviewViewProvider('git4vsc.logView', logPanel, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('git4vsc', new GitContentProvider(() => manager.all)));

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    try {
      const repository = await manager.open(folder.uri.fsPath);
      const adapter = new ScmRepositoryAdapter(repository);
      adapters.push(adapter);
      context.subscriptions.push(adapter);
      const sync = () => {
        commitView.refresh();
        conflictTree.refresh();
        void vscode.commands.executeCommand('setContext', 'git4vsc.hasConflicts', manager.all.some(candidate => candidate.snapshot.status?.changes.some(change => change.conflict)));
        void vscode.commands.executeCommand('setContext', 'git4vsc.operationInProgress', manager.all.some(candidate => candidate.snapshot.status?.phase !== 'normal' && candidate.snapshot.status?.phase !== 'detached'));
        void vscode.commands.executeCommand('setContext', 'git4vsc.busy', manager.all.some(candidate => operationActivity(candidate.snapshot.operation) !== null));
      };
      watchRepository(context, repository, sync);
      const unsubscribe = repository.onDidChange(sync);
      context.subscriptions.push({ dispose: unsubscribe });
    } catch {
      // A workspace folder is not necessarily a Git repository.
    }
  }
  commitView.refresh();
  conflictTree.refresh();
  void vscode.commands.executeCommand('setContext', 'git4vsc.hasConflicts', manager.all.some(repository => repository.snapshot.status?.changes.some(change => change.conflict)));
  void vscode.commands.executeCommand('setContext', 'git4vsc.operationInProgress', manager.all.some(repository => repository.snapshot.status?.phase !== 'normal' && repository.snapshot.status?.phase !== 'detached'));
  void vscode.commands.executeCommand('setContext', 'git4vsc.busy', manager.all.some(repository => operationActivity(repository.snapshot.operation) !== null));
  logPanel.initialize(manager.all[0]);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (!event.affectsConfiguration('git4vsc')) return;
    commitView.refresh();
    logPanel.refresh();
  }));

  const selectedRepository = (value?: unknown): RepositoryController | undefined => {
    if (value && typeof value === 'object' && 'location' in value) return value as RepositoryController;
    if (value && typeof value === 'object' && 'repository' in value) return (value as { repository: RepositoryController }).repository;
    if (value && typeof value === 'object' && 'rootUri' in value) {
      const root = (value as vscode.SourceControl).rootUri?.fsPath;
      return adapters.find(adapter => adapter.repository.root === root)?.repository;
    }
    return manager.all[0];
  };

  const selectedPath = (value?: unknown): string | undefined => value && typeof value === 'object' && 'path' in value
    ? (value as { path: string }).path
    : undefined;

  const selectedOperationRepository = (value?: unknown): RepositoryController | undefined => value === undefined
    ? manager.all.find(repository => repository.snapshot.status?.changes.some(change => change.conflict))
      ?? manager.all.find(repository => repository.snapshot.status?.phase !== 'normal' && repository.snapshot.status?.phase !== 'detached')
      ?? manager.all[0]
    : selectedRepository(value);

  const selectedConflictPaths = (values: readonly unknown[]): { repository: RepositoryController; paths: string[] } | undefined => {
    const repository = selectedRepository(values[0]);
    if (!repository) return undefined;
    const paths = [...new Set(values.filter(value => selectedRepository(value) === repository).map(selectedPath).filter((path): path is string => Boolean(path)))];
    return paths.length ? { repository, paths } : undefined;
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
      return commitRepository(repository, adapter?.sourceControl.inputBox.value);
    }),
    vscode.commands.registerCommand('git4vsc.commitAll', async (value?: RepositoryController) => {
      const repository = selectedRepository(value);
      const adapter = repository && adapters.find(candidate => candidate.repository === repository);
      return commitRepository(repository, adapter?.sourceControl.inputBox.value, true);
    }),
    vscode.commands.registerCommand('git4vsc.openCommitView', async (value?: RepositoryController) => {
      const repository = selectedRepository(value);
      if (repository) await commitView.show(repository);
    }),
    vscode.commands.registerCommand('git4vsc.showBranchMenu', async (value?: RepositoryController | vscode.SourceControl) => {
      const repository = selectedRepository(value);
      if (repository) await branchMenu.show(repository);
    }),
    vscode.commands.registerCommand('git4vsc.updateCurrentBranch', async (value?: RepositoryController | vscode.SourceControl) => {
      const repository = selectedRepository(value);
      if (repository) await branchMenu.update(repository);
    }),
    vscode.commands.registerCommand('git4vsc.updateCurrentBranchAvailable', (value?: RepositoryController | vscode.SourceControl) =>
      vscode.commands.executeCommand('git4vsc.updateCurrentBranch', value)
    ),
    vscode.commands.registerCommand('git4vsc.pushCurrentBranch', async (value?: RepositoryController | vscode.SourceControl) => {
      const repository = selectedRepository(value);
      if (repository) await branchMenu.pushCurrent(repository);
    }),
    vscode.commands.registerCommand('git4vsc.pushCurrentBranchAvailable', (value?: RepositoryController | vscode.SourceControl) =>
      vscode.commands.executeCommand('git4vsc.pushCurrentBranch', value)
    ),
    vscode.commands.registerCommand('git4vsc.openLog', async (value?: RepositoryController | GitResourceState) => {
      const repository = selectedRepository(value);
      if (repository) await logPanel.show(repository);
    }),
    vscode.commands.registerCommand('git4vsc.openSettings', (section?: string) => settingsPanel.show(section === 'ai' ? 'ai' : 'general')),
    vscode.commands.registerCommand('git4vsc.toggleLog', (value?: RepositoryController | GitResourceState) => {
      const repository = selectedRepository(value);
      if (repository) logPanel.toggle(repository);
    }),
    vscode.commands.registerCommand('git4vsc.justifyPanel', () => vscode.commands.executeCommand('workbench.action.alignPanelJustify')),
    vscode.commands.registerCommand('git4vsc.operationStatus', () => undefined),
    vscode.commands.registerCommand('git4vsc.resolveConflicts', async (value?: unknown) => {
      const repository = selectedOperationRepository(value);
      if (repository) await conflictResolver.start(repository, selectedPath(value));
    }),
    vscode.commands.registerCommand('git4vsc.openConflict', async (value?: unknown) => {
      const repository = selectedRepository(value);
      const path = selectedPath(value);
      if (repository && path) await conflictResolver.open(repository, path);
    }),
    vscode.commands.registerCommand('git4vsc.markConflictResolved', async (value?: unknown) => {
      if (value === undefined) await conflictResolver.markResolved();
      else await conflictResolver.markResolved(selectedRepository(value), selectedPath(value));
    }),
    vscode.commands.registerCommand('git4vsc.acceptCurrent', async (...values: unknown[]) => {
      const selection = selectedConflictPaths(values);
      if (selection) await conflictResolver.accept(selection.repository, selection.paths, 'ours');
    }),
    vscode.commands.registerCommand('git4vsc.acceptIncoming', async (...values: unknown[]) => {
      const selection = selectedConflictPaths(values);
      if (selection) await conflictResolver.accept(selection.repository, selection.paths, 'theirs');
    }),
    vscode.commands.registerCommand('git4vsc.restartConflict', async (value?: unknown) => {
      const repository = selectedRepository(value);
      const path = selectedPath(value);
      if (repository && path) await conflictResolver.restart(repository, path);
    }),
    vscode.commands.registerCommand('git4vsc.continueOperation', async (value?: unknown) => {
      const repository = selectedOperationRepository(value);
      if (repository) await conflictResolver.continue(repository);
    }),
    vscode.commands.registerCommand('git4vsc.abortOperation', async (value?: unknown) => {
      const repository = selectedOperationRepository(value);
      if (repository) await conflictResolver.abort(repository);
    })
  );
}

function watchRepository(context: vscode.ExtensionContext, repository: RepositoryController, refreshViews: () => void): void {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(repository.location.gitDir, '**/*'));
  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      repository.invalidate('status', 'log', 'refs');
      void repository.refresh().then(refreshViews);
    }, 150);
  };
  watcher.onDidCreate(schedule);
  watcher.onDidChange(schedule);
  watcher.onDidDelete(schedule);
  context.subscriptions.push(watcher, { dispose: () => clearTimeout(timer) });
}

export function deactivate(): void {}
