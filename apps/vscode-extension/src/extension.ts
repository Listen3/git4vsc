import * as vscode from 'vscode';
import { dirname, relative } from 'node:path';
import type { CommitSelection } from '@git4vsc/shared-types';
import { RepositoryManager, type RepositoryController } from '@git4vsc/repo-state';
import { BlameAnnotations } from './blame-annotations.js';
import { BranchMenu } from './branch-menu.js';
import { GitContentProvider, type GitResourceState, ScmRepositoryAdapter } from './scm-adapter.js';
import { ConflictResolver } from './conflict-resolver.js';
import { ConflictTree } from './conflict-tree.js';
import { CommitView, stagedChanges } from './commit-view.js';
import { LogPanel } from './log-panel.js';
import { notifyCommitResult } from './operation-notifications.js';
import { SettingsPanel } from './settings-panel.js';
import { isRepositoryIndex, repositoryInvalidations } from './repository-watch.js';
import { findWorkspaceRepositoryRoots, repositoryContainingPath } from './repository-discovery.js';
import { WorktreeManager, type WorktreeItem } from './worktree-manager.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const manager = new RepositoryManager();
  const openRepository = async (path: string): Promise<RepositoryController> => {
    const repository = await manager.open(path);
    registerRepository(repository);
    return repository;
  };
  const blameAnnotations = new BlameAnnotations(() => manager.all, path => openRepository(dirname(path)));
  const adapters: ScmRepositoryAdapter[] = [];
  const conflictTree = new ConflictTree(() => manager.all);
  const conflictResolver = new ConflictResolver(() => conflictTree.refresh());
  const commitRepository = async (repository: RepositoryController | undefined, message: string | undefined, all = false, paths?: readonly string[], selections?: readonly CommitSelection[]): Promise<boolean> => {
    if (repository?.snapshot.status?.changes.some(change => change.conflict)) {
      void vscode.window.showWarningMessage('Resolve all merge conflicts before committing.');
      await conflictResolver.start(repository);
      return false;
    }
    if (!repository || !message?.trim()) {
      void vscode.window.showWarningMessage('Enter a commit message.');
      return false;
    }
    if (!all && paths === undefined && selections === undefined && !stagedChanges(repository.snapshot.status?.changes ?? []).length) {
      void vscode.window.showWarningMessage('Stage at least one change before committing.');
      return false;
    }
    if (paths?.length === 0 || selections?.length === 0) {
      void vscode.window.showWarningMessage('Select at least one change before committing.');
      return false;
    }
    const wholePaths = selections?.every(selection => selection.hunkIds === undefined)
      ? [...new Set(selections.flatMap(selection => [selection.originalPath, selection.path].filter((path): path is string => Boolean(path))))]
      : null;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl, title: 'Committing…' }, () => wholePaths
      ? repository.commitPaths(message.trim(), wholePaths)
      : selections ? repository.commitSelections(message.trim(), selections)
        : paths ? repository.commitPaths(message.trim(), paths) : repository.commit(message.trim(), all));
    const head = repository.snapshot.status?.head ?? null;
    notifyCommitResult(head, message.trim());
    if (head) logPanel.revealCommit(repository, head);
    const adapter = adapters.find(candidate => candidate.repository === repository);
    if (adapter) adapter.sourceControl.inputBox.value = '';
    return true;
  };
  const previewPush = (repository: RepositoryController, branch: string, remote: string, upstream?: string) => commitView.previewPush(repository, branch, remote, upstream);
  const worktreeManager = new WorktreeManager(() => manager.all[0]);
  const logPanel = new LogPanel(context, () => manager.all[0], previewPush, () => worktreeManager.refresh());
  const settingsPanel = new SettingsPanel(context);
  const branchMenu = new BranchMenu(previewPush);
  const commitView = new CommitView(context, () => manager.all, {
    commit: (repository, message, selections) => commitRepository(repository, message, false, undefined, selections),
    push: repository => branchMenu.pushCurrent(repository),
    selectRepository: repository => {
      logPanel.select(repository);
      worktreeManager.select(repository);
    }
  });
  context.subscriptions.push(commitView, settingsPanel, blameAnnotations, vscode.window.registerWebviewViewProvider('git4vsc.repositories', commitView, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(conflictResolver, vscode.window.registerTreeDataProvider('git4vsc.conflicts', conflictTree));
  context.subscriptions.push(logPanel, vscode.window.registerWebviewViewProvider('git4vsc.logView', logPanel, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(worktreeManager, vscode.window.registerTreeDataProvider('git4vsc.worktrees', worktreeManager));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('git4vsc', new GitContentProvider(() => manager.all)));

  const registeredRoots = new Set<string>();
  const syncViews = () => {
    commitView.refresh();
    conflictTree.refresh();
    worktreeManager.refresh();
    void vscode.commands.executeCommand('setContext', 'git4vsc.hasConflicts', manager.all.some(candidate => candidate.snapshot.status?.changes.some(change => change.conflict)));
    void vscode.commands.executeCommand('setContext', 'git4vsc.operationInProgress', manager.all.some(candidate => candidate.snapshot.status?.phase !== 'normal' && candidate.snapshot.status?.phase !== 'detached'));
  };
  const registerRepository = (repository: RepositoryController) => {
    if (registeredRoots.has(repository.root)) return;
    registeredRoots.add(repository.root);
    const adapter = new ScmRepositoryAdapter(repository);
    adapters.push(adapter);
    context.subscriptions.push(adapter);
    watchRepository(context, repository, syncViews);
    const unsubscribe = repository.onDidChange(syncViews);
    context.subscriptions.push({ dispose: unsubscribe });
    syncViews();
    logPanel.prewarm(repository);
  };
  const openWorkspaceRepositories = async (folder: vscode.WorkspaceFolder) => {
    try {
      await openRepository(folder.uri.fsPath);
    } catch {
      // A workspace folder can contain repositories without being one itself.
    }
    const roots = await findWorkspaceRepositoryRoots(folder.uri.fsPath);
    for (let index = 0; index < roots.length; index += 3) {
      await Promise.allSettled(roots.slice(index, index + 3).map(root => openRepository(root)));
    }
  };
  const folders = vscode.workspace.workspaceFolders ?? [];
  const savedRoot = context.workspaceState.get<string>('git4vsc.commit.activeRoot');
  const activeFile = vscode.window.activeTextEditor?.document.uri.scheme === 'file'
    ? dirname(vscode.window.activeTextEditor.document.uri.fsPath)
    : undefined;
  const preferredPaths = [...new Set([
    ...(savedRoot && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(savedRoot)) ? [savedRoot] : []),
    ...(activeFile && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(activeFile)) ? [activeFile] : []),
    ...folders.map(folder => folder.uri.fsPath)
  ])];
  let initialRepository: RepositoryController | undefined;
  for (const path of preferredPaths) {
    try {
      initialRepository = await openRepository(path);
      break;
    } catch {
      // Try the next current-context candidate before scanning nested folders.
    }
  }
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(event => {
    for (const folder of event.added) void openWorkspaceRepositories(folder);
  }));
  syncViews();
  logPanel.initialize(initialRepository);
  worktreeManager.select(initialRepository);
  for (const folder of folders) void openWorkspaceRepositories(folder);
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
    return commitView.selectedRepository() ?? manager.all[0];
  };

  const selectedPath = (value?: unknown): string | undefined => value && typeof value === 'object' && 'path' in value
    ? (value as { path: string }).path
    : undefined;

  const editorUri = (value?: unknown): vscode.Uri | undefined => value instanceof vscode.Uri
    ? value
    : vscode.window.activeTextEditor?.document.uri;

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
    vscode.commands.registerCommand('git4vsc.toggleBlameAnnotations', (uri?: vscode.Uri) => blameAnnotations.toggle(uri)),
    vscode.commands.registerCommand('git4vsc.showBlameCommit', async (file: unknown, hash: unknown) => {
      if (typeof file !== 'string' || typeof hash !== 'string' || !hash || /^0+$/.test(hash)) return;
      const repository = repositoryContainingPath(manager.all, file) ?? await openRepository(dirname(file));
      await commitView.select(repository);
      await logPanel.showCommit(repository, hash);
    }),
    vscode.commands.registerCommand('git4vsc.openWorktrees', async () => {
      worktreeManager.select(selectedRepository());
      await vscode.commands.executeCommand('git4vsc.worktrees.focus');
    }),
    vscode.commands.registerCommand('git4vsc.refreshWorktrees', () => worktreeManager.refresh()),
    vscode.commands.registerCommand('git4vsc.newWorktree', () => worktreeManager.create()),
    vscode.commands.registerCommand('git4vsc.openWorktree', (item: WorktreeItem) => worktreeManager.open(item)),
    vscode.commands.registerCommand('git4vsc.deleteWorktree', (item: WorktreeItem) => worktreeManager.remove(item)),
    vscode.commands.registerCommand('git4vsc.pruneWorktrees', () => worktreeManager.prune()),
    vscode.commands.registerCommand('git4vsc.lockWorktree', (item: WorktreeItem) => worktreeManager.lock(item)),
    vscode.commands.registerCommand('git4vsc.unlockWorktree', (item: WorktreeItem) => worktreeManager.unlock(item)),
    vscode.commands.registerCommand('git4vsc.copyWorktreePath', (item: WorktreeItem) => worktreeManager.copyPath(item)),
    vscode.commands.registerCommand('git4vsc.showFileHistory', async (value?: unknown) => {
      const uri = editorUri(value);
      if (!uri || uri.scheme !== 'file') return;
      const repository = repositoryContainingPath(manager.all, uri.fsPath) ?? await openRepository(dirname(uri.fsPath));
      const path = relative(repository.root, uri.fsPath).replaceAll('\\', '/');
      await commitView.select(repository);
      await logPanel.showFileHistory(repository, path);
    }),
    vscode.commands.registerCommand('git4vsc.refresh', async (value?: RepositoryController | vscode.SourceControl) => {
      const repository = selectedRepository(value);
      if (!repository) return;
      repository.invalidate('status', 'log', 'refs');
      await repository.refresh();
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
    vscode.commands.registerCommand('git4vsc.stashChanges', async (value?: RepositoryController | vscode.SourceControl) => {
      const repository = selectedRepository(value);
      if (repository) await branchMenu.stashChanges(repository);
    }),
    vscode.commands.registerCommand('git4vsc.manageStashes', async (value?: RepositoryController | vscode.SourceControl) => {
      const repository = selectedRepository(value);
      if (repository) await branchMenu.manageStashes(repository);
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
      if (repository) {
        await commitView.select(repository);
        await logPanel.show(repository);
      }
    }),
    vscode.commands.registerCommand('git4vsc.openSettings', (section?: string) => settingsPanel.show(section === 'ai' ? 'ai' : 'general')),
    vscode.commands.registerCommand('git4vsc.toggleLog', async (value?: RepositoryController | GitResourceState) => {
      const repository = selectedRepository(value);
      if (repository) {
        await commitView.select(repository);
        logPanel.toggle(repository);
      }
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
    vscode.commands.registerCommand/*  */('git4vsc.acceptCurrent', async (...values: unknown[]) => {
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
  const worktreeWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(repository.root, '**/*'));
  const gitPaths = [...new Set([repository.location.gitDir, repository.location.commonDir ?? repository.location.gitDir])];
  const gitWatchers = gitPaths.map(path => vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path, '**/*')));
  let timer: NodeJS.Timeout | undefined;
  let activeRefreshes = 0;
  let ignoreIndexUntil = 0;
  const pending = new Set<ReturnType<typeof repositoryInvalidations>[number]>();
  const schedule = (uri: vscode.Uri) => {
    if (isRepositoryIndex(repository.location.gitDir, uri.fsPath) && (activeRefreshes > 0 || Date.now() < ignoreIndexUntil)) return;
    repositoryInvalidations(repository.root, repository.location.gitDir, uri.fsPath, repository.location.commonDir).forEach(part => pending.add(part));
    if (pending.size === 0) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      repository.invalidate(...pending);
      pending.clear();
      activeRefreshes += 1;
      void repository.refresh().then(refreshViews).finally(() => {
        activeRefreshes -= 1;
        ignoreIndexUntil = Date.now() + 500;
      });
    }, 120);
  };
  for (const watcher of [worktreeWatcher, ...gitWatchers]) {
    watcher.onDidCreate(schedule);
    watcher.onDidChange(schedule);
    watcher.onDidDelete(schedule);
  }
  context.subscriptions.push(worktreeWatcher, ...gitWatchers, { dispose: () => clearTimeout(timer) });
}

export function deactivate(): void {}
