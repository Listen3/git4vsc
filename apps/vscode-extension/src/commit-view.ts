import path from 'node:path';
import * as vscode from 'vscode';
import { isPushRejectedError } from '@git4vsc/git-core';
import type { CommitFileChange, CommitSelection, GitChange, GitDiffHunk, PushPreviewDialogRequest } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';
import { AiRequestCancelledError, aiIsConfigured, generateAiCommitMessage, onDidChangeAiSettings } from './ai-settings.js';
import { gitResourceUri } from './git-uri.js';
import { branchTrackingSuffix, changesViewBadge, operationActivity } from './repository-status.js';
import { readGeneralSettings } from './settings.js';
import { notifyPushResult, resultNotificationsEnabled } from './operation-notifications.js';
import { isProtectedBranch } from './protected-branches.js';
import { checkoutWithSmartFallback, updateWithSmartFallback } from './smart-operations.js';
import { pickUpdateStrategy } from './update-strategy.js';
import {
  changelistSnapshot,
  createChangelist,
  movePathsToChangelist,
  normalizeChangelistState,
  removeChangelist,
  setActiveChangelist,
  synchronizeChangelists,
  updateChangelist,
  type ChangelistState
} from './changelists.js';

interface CommitViewActions {
  commit(repository: RepositoryController, message: string, selections: readonly CommitSelection[]): Promise<boolean>;
  push(repository: RepositoryController): Promise<void>;
  selectRepository(repository: RepositoryController): void;
}

interface CommitViewMessage {
  type: 'ready' | 'selectRepository' | 'message' | 'select' | 'selectHunks' | 'loadHunks' | 'replaceSelection' | 'createChangelist' | 'updateChangelist' | 'deleteChangelist' | 'setActiveChangelist' | 'moveToChangelist' | 'openChange' | 'resolveConflict' | 'rollback' | 'rollbackFile' | 'deleteFile' | 'jumpToSource' | 'addToVcs' | 'addToIgnore' | 'openAiSettings' | 'generateCommitMessage' | 'cancelCommitMessage' | 'commit' | 'commitAndPush' | 'closePushPreview' | 'openPushPreviewDiff' | 'pushPreview';
  root?: string;
  message?: string;
  paths?: string[];
  path?: string;
  hash?: string;
  change?: CommitFileChange;
  targetBranch?: string;
  force?: boolean;
  side?: 'staged' | 'working';
  selected?: boolean;
  hunkIds?: string[];
  id?: string;
  targetId?: string;
  name?: string;
  description?: string;
  active?: boolean;
}

export class CommitView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | null = null;
  private activeRoot: string | null;
  private readonly messages = new Map<string, string>();
  private readonly selections = new Map<string, Set<string>>();
  private readonly visibleChanges = new Map<string, Set<string>>();
  private readonly changelistStates = new Map<string, ChangelistState>();
  private readonly hunks = new Map<string, Map<string, GitDiffHunk[]>>();
  private readonly hunkSelections = new Map<string, Map<string, Set<string>>>();
  private readonly hunkVersions = new Map<string, number>();
  private readonly loadingHunks = new Map<string, Set<string>>();
  private readonly aiRequests = new Map<string, AbortController>();
  private readonly aiSettingsSubscription: vscode.Disposable;
  private pushPreview: PushPreviewDialogRequest | null = null;
  private pushPreviewRemote: string | null = null;
  private snapshotRequest = 0;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repositories: () => readonly RepositoryController[],
    private readonly actions: CommitViewActions
  ) {
    this.activeRoot = context.workspaceState.get<string>('git4vsc.commit.activeRoot') ?? null;
    this.aiSettingsSubscription = onDidChangeAiSettings(() => this.refresh());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')]
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(message => void this.handle(message as CommitViewMessage));
    view.onDidDispose(() => { this.view = null; });
    this.refresh();
  }

  refresh(): void {
    void this.postSnapshot(++this.snapshotRequest);
  }

  private async postSnapshot(request: number): Promise<void> {
    if (!this.view) return;
    const repositories = this.repositories();
    const repository = repositories.find(candidate => candidate.root === this.activeRoot) ?? repositories[0];
    this.activeRoot = repository?.root ?? null;
    if (repository) this.actions.selectRepository(repository);
    const status = repository?.snapshot.status;
    const changelists = repository ? this.changelists(repository) : null;
    if (repository && changelists && status) {
      const previousPaths = this.visibleChanges.get(repository.root);
      const currentPaths = new Set(status.changes.map(change => change.path));
      const appeared = previousPaths ? status.changes.filter(change => !previousPaths.has(change.path)) : [];
      if (synchronizeChangelists(changelists, status.changes)) await this.persistChangelists(repository.root, changelists);
      const selection = this.selections.get(repository.root);
      for (const change of appeared) {
        if (selection && !change.conflict && change.workingTree !== 'untracked' && changelists.assignments[change.path] === changelists.activeId) selection.add(change.path);
      }
      this.visibleChanges.set(repository.root, currentPaths);
    }
    void vscode.commands.executeCommand('setContext', 'git4vsc.hasIncoming', Boolean(status?.upstream && status.behind));
    void vscode.commands.executeCommand('setContext', 'git4vsc.hasOutgoing', Boolean(status?.upstream && status.ahead));
    void vscode.commands.executeCommand('setContext', 'git4vsc.busy', operationActivity(repository?.snapshot.operation ?? null) !== null);
    const aiConfigured = await aiIsConfigured(this.context);
    if (!this.view || request !== this.snapshotRequest) return;
    if (repository && !this.messages.has(repository.root)) {
      this.messages.set(repository.root, this.context.workspaceState.get<string>(this.messageKey(repository.root)) ?? '');
    }
    if (repository && this.hunkVersions.get(repository.root) !== repository.snapshot.version) {
      this.hunkVersions.set(repository.root, repository.snapshot.version);
      this.hunks.delete(repository.root);
      this.hunkSelections.delete(repository.root);
      this.loadingHunks.delete(repository.root);
    }
    const selection = repository ? this.selection(repository) : new Set<string>();
    const operation = repository?.snapshot.operation ?? null;
    const loading = repository?.snapshot.loading.has('status') ?? false;
    const showOperationProgress = readGeneralSettings().showOperationProgress;
    const branch = status?.branch ?? status?.head?.slice(0, 8) ?? 'HEAD';
    const tracking = branchTrackingSuffix(status);
    this.view.title = repository ? `${this.pushPreview ? 'Push' : 'Commit'} — ${branch}${tracking ? ` ${tracking}` : ''}` : 'Commit';
    this.view.badge = changesViewBadge(repositories.map(candidate => candidate.snapshot.status));
    void this.view.webview.postMessage({
      type: 'commitSnapshot',
      state: {
        repositories: repositories.map(candidate => ({
          root: candidate.root,
          name: path.basename(candidate.root),
          branch: candidate.snapshot.status?.branch ?? candidate.snapshot.status?.head?.slice(0, 8) ?? 'HEAD',
          changes: candidate.snapshot.status?.changes.length ?? 0
        })),
        activeRoot: repository?.root ?? null,
        status: repository?.snapshot.status ?? null,
        changelists: changelists ? changelistSnapshot(changelists) : [],
        selectedPaths: [...selection],
        hunks: Object.fromEntries(this.hunks.get(repository?.root ?? '') ?? []),
        selectedHunks: Object.fromEntries([...(this.hunkSelections.get(repository?.root ?? '') ?? [])].map(([file, ids]) => [file, [...ids]])),
        loadingHunkPaths: [...(this.loadingHunks.get(repository?.root ?? '') ?? [])],
        message: repository ? this.messages.get(repository.root) ?? '' : '',
        loading,
        operation,
        activity: showOperationProgress ? (operation ? operationActivity(operation) : loading ? 'Refreshing…' : null) : null,
        error: repository?.snapshot.error ?? null,
        aiConfigured,
        aiGenerating: repository ? this.aiRequests.has(repository.root) : false,
        pushPreview: repository?.root === this.activeRoot ? this.pushPreview : null
      }
    });
  }

  async previewPush(repository: RepositoryController, branch: string, remote: string, upstream?: string): Promise<void> {
    const targetBranch = upstream?.startsWith(`${remote}/`) ? upstream.slice(remote.length + 1) : branch;
    const preview = await vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl, title: 'Preparing push preview…' }, async () => {
      const commits = await repository.git.outgoingCommits(repository.location, branch, remote, upstream);
      const files = await repository.git.commitFiles(repository.location, commits);
      return commits.map(commit => ({ commit, files: files.get(commit.hash) ?? [] }));
    });
    if (!preview.length) {
      if (resultNotificationsEnabled()) void vscode.window.showInformationMessage('Everything is up to date.');
      return;
    }
    this.pushPreview = {
      id: Date.now(),
      kind: 'push-preview',
      title: 'Push Preview',
      source: branch,
      remote,
      targetBranch,
      target: `${remote}/${targetBranch}`,
      existingTargetBranches: (repository.snapshot.status?.refs ?? [])
        .filter(ref => ref.type === 'remote-branch' && ref.name.startsWith(`${remote}/`))
        .map(ref => ref.name.slice(remote.length + 1)),
      protectedBranches: readGeneralSettings().protectedBranches,
      commits: preview
    };
    this.pushPreviewRemote = remote;
    await this.show(repository);
  }

  async show(repository: RepositoryController): Promise<void> {
    await this.select(repository);
    await vscode.commands.executeCommand('workbench.view.extension.git4vsc');
    await vscode.commands.executeCommand('git4vsc.repositories.focus');
  }

  async select(repository: RepositoryController): Promise<void> {
    if (this.activeRoot !== repository.root) {
      this.pushPreview = null;
      this.pushPreviewRemote = null;
    }
    this.activeRoot = repository.root;
    this.actions.selectRepository(repository);
    await this.context.workspaceState.update('git4vsc.commit.activeRoot', repository.root);
    this.refresh();
  }

  dispose(): void {
    this.aiSettingsSubscription.dispose();
    for (const request of this.aiRequests.values()) request.abort();
    this.aiRequests.clear();
    this.view = null;
  }

  private async handle(message: CommitViewMessage): Promise<void> {
    if (message.type === 'ready') return this.refresh();
    if (message.type === 'selectRepository' && message.root) {
      const repository = this.repositories().find(candidate => candidate.root === message.root);
      if (repository) await this.select(repository);
      return;
    }
    if (message.type === 'openAiSettings') {
      await vscode.commands.executeCommand('git4vsc.openSettings', 'ai');
      return;
    }

    const repository = this.selectedRepository();
    if (!repository) return;
    if (message.type === 'closePushPreview') {
      this.pushPreview = null;
      this.pushPreviewRemote = null;
      return this.refresh();
    }
    if (message.type === 'openPushPreviewDiff' && this.pushPreview && message.hash && message.change) {
      const item = this.pushPreview.commits.find(candidate => candidate.commit.hash === message.hash);
      const change = item?.files.find(candidate => candidate.path === message.change?.path && candidate.status === message.change?.status);
      if (!item || !change) return;
      const parent = item.commit.parents[0] ?? null;
      const left = gitResourceUri(repository, change.originalPath ?? change.path, change.status === 'added' ? null : parent);
      const right = gitResourceUri(repository, change.path, change.status === 'deleted' ? null : item.commit.hash);
      await vscode.commands.executeCommand('vscode.diff', left, right, `${change.path} (${item.commit.hash.slice(0, 8)})`, { preview: true });
      return;
    }
    if (message.type === 'pushPreview' && this.pushPreview && this.pushPreviewRemote && message.targetBranch?.trim()) {
      const preview = this.pushPreview;
      const targetBranch = message.targetBranch.trim();
      const force = Boolean(message.force);
      const settings = readGeneralSettings();
      if (force && isProtectedBranch(targetBranch, settings.protectedBranches)) {
        void vscode.window.showWarningMessage(`Force Push is disabled for protected branch ${targetBranch}.`);
        return;
      }
      if (force && settings.confirmForcePush) {
        const confirmed = await vscode.window.showWarningMessage(
          `Force Push ${preview.source} to ${this.pushPreviewRemote}/${targetBranch}?`,
          { modal: true, detail: 'This uses --force-with-lease and can rewrite remote history.' },
          'Force Push'
        );
        if (confirmed !== 'Force Push') return;
      }
      if (!await this.pushWithRejectedRecovery(repository, preview.source, this.pushPreviewRemote, targetBranch, force)) return;
      notifyPushResult(preview.commits.length, `${this.pushPreviewRemote}/${targetBranch}`);
      this.pushPreview = null;
      this.pushPreviewRemote = null;
      return this.refresh();
    }
    if (message.type === 'message') {
      const value = message.message ?? '';
      this.messages.set(repository.root, value);
      await this.context.workspaceState.update(this.messageKey(repository.root), value);
      return;
    }
    if (message.type === 'select' && message.paths?.length && message.selected !== undefined) {
      const selection = this.selection(repository);
      const hunkSelections = this.hunkSelections.get(repository.root);
      for (const path of message.paths) {
        if (message.selected) selection.add(path);
        else selection.delete(path);
        hunkSelections?.delete(path);
      }
      return this.refresh();
    }
    if (message.type === 'loadHunks' && message.path) {
      const loading = this.loadingHunks.get(repository.root) ?? new Set<string>();
      this.loadingHunks.set(repository.root, loading);
      loading.add(message.path);
      this.refresh();
      try {
        const hunks = await repository.git.diffHunks(repository.location, message.path);
        const files = this.hunks.get(repository.root) ?? new Map<string, GitDiffHunk[]>();
        this.hunks.set(repository.root, files);
        files.set(message.path, hunks);
      } finally {
        loading.delete(message.path);
        this.refresh();
      }
      return;
    }
    if (message.type === 'createChangelist' && message.name) {
      const state = this.changelists(repository);
      try {
        const id = createChangelist(state, message.name, message.description ?? '', Boolean(message.active));
        if (message.paths?.length) {
          movePathsToChangelist(state, id, message.paths);
          this.updateMovedSelection(repository, id, message.paths);
        }
        if (message.active) this.selectChangelistChanges(repository, id);
        await this.persistChangelists(repository.root, state);
      } catch (error) {
        void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
      }
      return this.refresh();
    }
    if (message.type === 'updateChangelist' && message.id && message.name) {
      const state = this.changelists(repository);
      try {
        updateChangelist(state, message.id, message.name, message.description ?? '');
        await this.persistChangelists(repository.root, state);
      } catch (error) {
        void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
      }
      return this.refresh();
    }
    if (message.type === 'setActiveChangelist' && message.id) {
      const state = this.changelists(repository);
      try {
        setActiveChangelist(state, message.id);
        this.selectChangelistChanges(repository, message.id);
        await this.persistChangelists(repository.root, state);
      } catch (error) {
        void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
      }
      return this.refresh();
    }
    if (message.type === 'moveToChangelist' && message.id && message.paths?.length) {
      const state = this.changelists(repository);
      try {
        const movedPaths = message.paths.filter(path => state.assignments[path] !== message.id);
        if (movedPaths.length) {
          movePathsToChangelist(state, message.id, movedPaths);
          this.updateMovedSelection(repository, message.id, movedPaths);
          await this.persistChangelists(repository.root, state);
        }
      } catch (error) {
        void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
      }
      return this.refresh();
    }
    if (message.type === 'deleteChangelist' && message.id && message.targetId) {
      const state = this.changelists(repository);
      try {
        const wasActive = state.activeId === message.id;
        const movedPaths = Object.keys(state.assignments).filter(path => state.assignments[path] === message.id);
        removeChangelist(state, message.id, message.targetId);
        if (wasActive) this.selectChangelistChanges(repository, state.activeId);
        else this.updateMovedSelection(repository, message.targetId, movedPaths);
        await this.persistChangelists(repository.root, state);
      } catch (error) {
        void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
      }
      return this.refresh();
    }
    if (message.type === 'selectHunks' && message.path && message.hunkIds) {
      const files = this.hunkSelections.get(repository.root) ?? new Map<string, Set<string>>();
      this.hunkSelections.set(repository.root, files);
      files.set(message.path, new Set(message.hunkIds));
      if (message.hunkIds.length) this.selection(repository).add(message.path);
      else this.selection(repository).delete(message.path);
      return this.refresh();
    }
    if (message.type === 'replaceSelection' && message.paths?.length) {
      this.selections.set(repository.root, new Set(message.paths));
      this.hunkSelections.delete(repository.root);
      return this.refresh();
    }
    if (message.type === 'resolveConflict' && message.path) {
      return void await vscode.commands.executeCommand('git4vsc.openConflict', { repository, path: message.path });
    }
    if (message.type === 'openChange' && message.path && message.side) {
      return void await this.openChange(repository, message.path, message.side);
    }
    if ((message.type === 'rollback' || message.type === 'rollbackFile')) {
      const selected = this.selection(repository);
      const requested = message.type === 'rollbackFile'
        ? new Set(message.paths?.length ? message.paths : message.path ? [message.path] : [])
        : selected;
      const changes = (repository.snapshot.status?.changes ?? []).filter(change => requested.has(change.path) && !change.conflict && change.workingTree !== 'untracked');
      if (!changes.length) return;
      const confirmed = await vscode.window.showWarningMessage(
        `Rollback ${changes.length} selected change${changes.length === 1 ? '' : 's'}?`,
        { modal: true, detail: 'Tracked modifications will be restored to HEAD. Added files will be kept as unversioned files.' },
        'Rollback'
      );
      if (!confirmed) return;
      await repository.rollbackChanges(changes);
      for (const change of changes) selected.delete(change.path);
      return this.refresh();
    }
    if (message.type === 'deleteFile' && message.path) {
      const confirmed = await vscode.window.showWarningMessage(`Delete ${message.path}?`, { modal: true, detail: 'The file will be moved to the Recycle Bin.' }, 'Delete');
      if (!confirmed) return;
      await vscode.workspace.fs.delete(this.fileUri(repository, message.path), { useTrash: true });
      repository.invalidate('status');
      await repository.refresh();
      return this.refresh();
    }
    if (message.type === 'jumpToSource' && message.path) {
      return void await vscode.window.showTextDocument(this.fileUri(repository, message.path));
    }
    if (message.type === 'addToVcs' && (message.paths?.length || message.path)) {
      const paths = message.paths?.length ? message.paths : [message.path!];
      await repository.stage(paths);
      for (const path of paths) this.selection(repository).add(path);
      return this.refresh();
    }
    if (message.type === 'addToIgnore' && message.path) {
      await repository.addToIgnore(message.path);
      this.selection(repository).delete(message.path);
      return this.refresh();
    }
    if (message.type === 'generateCommitMessage') {
      return this.generateCommitMessage(repository);
    }
    if (message.type === 'cancelCommitMessage') {
      this.cancelCommitMessage(repository);
      return;
    }
    if (message.type === 'commit' || message.type === 'commitAndPush') {
      const value = (message.message ?? this.messages.get(repository.root) ?? '').trim();
      const selected = this.selection(repository);
      const partial = this.hunkSelections.get(repository.root);
      const selections = (repository.snapshot.status?.changes ?? []).filter(change => selected.has(change.path)).map(change => ({
        path: change.path,
        ...(change.originalPath ? { originalPath: change.originalPath } : {}),
        ...(partial?.has(change.path) ? { hunkIds: [...partial.get(change.path)!] } : {})
      }));
      if (await this.actions.commit(repository, value, selections)) {
        this.selections.set(repository.root, new Set());
        this.hunkSelections.delete(repository.root);
        this.messages.set(repository.root, '');
        await this.context.workspaceState.update(this.messageKey(repository.root), '');
        if (message.type === 'commitAndPush') await this.actions.push(repository);
        else this.refresh();
      }
    }
  }

  private async pushWithRejectedRecovery(repository: RepositoryController, source: string, remote: string, targetBranch: string, force: boolean): Promise<boolean> {
    try {
      await repository.pushBranch(source, remote, targetBranch, force);
      return true;
    } catch (error) {
      if (!isPushRejectedError(error)) throw error;
    }

    const settings = readGeneralSettings();
    let rebase: boolean | undefined;
    if (settings.autoUpdateOnPushRejected) rebase = await pickUpdateStrategy();
    else {
      const choice = await vscode.window.showWarningMessage(
        `Push of ${source} was rejected because ${remote}/${targetBranch} contains commits that are not local.`,
        { modal: true, detail: 'Update the current branch, then Git4VSC will retry the push once.' },
        'Merge and Push',
        'Rebase and Push'
      );
      if (choice === 'Merge and Push') rebase = false;
      else if (choice === 'Rebase and Push') rebase = true;
    }
    if (rebase === undefined) return false;
    if (repository.snapshot.status?.branch !== source && !await checkoutWithSmartFallback(repository, source)) return false;
    if (!await updateWithSmartFallback(repository, remote, targetBranch, rebase)) return false;
    if (repository.snapshot.status?.changes.some(change => change.conflict)) {
      await vscode.commands.executeCommand('git4vsc.resolveConflicts', repository);
      return false;
    }
    await repository.pushBranch(source, remote, targetBranch, force);
    return true;
  }

  private async generateCommitMessage(repository: RepositoryController): Promise<void> {
    if (this.aiRequests.has(repository.root)) return;
    const selectedPaths = new Set(this.selection(repository));
    const request = new AbortController();
    this.aiRequests.set(repository.root, request);
    this.refresh();
    try {
      if (!await aiIsConfigured(this.context)) throw new Error('Configure Base URL, API key and model in Git4VSC Settings → AI.');
      const status = await repository.git.status(repository.location);
      const changes = status.changes.filter(change => selectedPaths.has(change.path));
      if (!changes.length) throw new Error('Select at least one changed file.');
      if (changes.some(change => change.conflict)) throw new Error('Resolve merge conflicts before generating a commit message.');
      const context = await repository.git.commitMessageContext(repository.location, status.head, changes);
      const message = await generateAiCommitMessage(this.context, path.basename(repository.root), status.branch ?? 'HEAD', context, request.signal);
      if (request.signal.aborted) throw new AiRequestCancelledError();
      this.messages.set(repository.root, message);
      await this.context.workspaceState.update(this.messageKey(repository.root), message);
    } catch (error) {
      if (!(error instanceof AiRequestCancelledError)) void vscode.window.showErrorMessage(`Unable to generate commit message: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (this.aiRequests.get(repository.root) === request) this.aiRequests.delete(repository.root);
      this.refresh();
    }
  }

  private cancelCommitMessage(repository: RepositoryController): void {
    const request = this.aiRequests.get(repository.root);
    if (!request) return;
    this.aiRequests.delete(repository.root);
    request.abort();
    this.refresh();
  }

  selectedRepository(): RepositoryController | undefined {
    return this.repositories().find(repository => repository.root === this.activeRoot) ?? this.repositories()[0];
  }

  private selection(repository: RepositoryController): Set<string> {
    const changes = repository.snapshot.status?.changes.filter(change => !change.conflict) ?? [];
    const existing = this.selections.get(repository.root);
    if (!existing) {
      const changelists = this.changelists(repository);
      const initial = new Set(changes
        .filter(change => change.workingTree !== 'untracked' && changelists.assignments[change.path] === changelists.activeId)
        .map(change => change.path));
      this.selections.set(repository.root, initial);
      return initial;
    }
    const paths = new Set(changes.map(change => change.path));
    for (const path of existing) if (!paths.has(path)) existing.delete(path);
    return existing;
  }

  private selectChangelistChanges(repository: RepositoryController, id: string): void {
    const assignments = this.changelists(repository).assignments;
    const paths = repository.snapshot.status?.changes
      .filter(change => !change.conflict && change.workingTree !== 'untracked' && assignments[change.path] === id)
      .map(change => change.path) ?? [];
    this.selections.set(repository.root, new Set(paths));
    this.hunkSelections.delete(repository.root);
  }

  private updateMovedSelection(repository: RepositoryController, targetId: string, paths: readonly string[]): void {
    const selection = this.selection(repository);
    const active = this.changelists(repository).activeId === targetId;
    const hunkSelections = this.hunkSelections.get(repository.root);
    for (const path of paths) {
      if (active) selection.add(path);
      else selection.delete(path);
      hunkSelections?.delete(path);
    }
  }

  private changelists(repository: RepositoryController): ChangelistState {
    const existing = this.changelistStates.get(repository.root);
    if (existing) return existing;
    const state = normalizeChangelistState(this.context.workspaceState.get(this.changelistKey(repository.root)));
    this.changelistStates.set(repository.root, state);
    return state;
  }

  private persistChangelists(root: string, state: ChangelistState): Thenable<void> {
    return this.context.workspaceState.update(this.changelistKey(root), state);
  }

  private async openChange(repository: RepositoryController, filePath: string, side: 'staged' | 'working'): Promise<void> {
    const change = repository.snapshot.status?.changes.find(candidate => candidate.path === filePath);
    if (change?.conflict) {
      await vscode.commands.executeCommand('git4vsc.openConflict', { repository, path: filePath });
      return;
    }
    const file = vscode.Uri.joinPath(vscode.Uri.file(repository.root), filePath);
    if (change?.workingTree === 'untracked') {
      await vscode.window.showTextDocument(file);
      return;
    }
    const beforePath = change?.originalPath ?? filePath;
    const left = side === 'staged' ? gitResourceUri(repository, beforePath, 'HEAD') : gitResourceUri(repository, beforePath, 'index');
    const right = side === 'staged'
      ? gitResourceUri(repository, filePath, 'index')
      : change?.workingTree === 'deleted' ? gitResourceUri(repository, filePath, null) : file;
    await vscode.commands.executeCommand('vscode.diff', left, right, `${filePath} (${side === 'staged' ? 'Index' : 'Working Tree'})`);
  }

  private fileUri(repository: RepositoryController, filePath: string): vscode.Uri {
    return vscode.Uri.joinPath(vscode.Uri.file(repository.root), filePath);
  }

  private messageKey(root: string): string {
    return `git4vsc.commit.message.${root}`;
  }

  private changelistKey(root: string): string {
    return `git4vsc.commit.changelists.${root}`;
  }

  private html(webview: vscode.Webview): string {
    const cacheKey = `${this.context.extension.packageJSON.version}-${Date.now()}`;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets', 'main.js')).with({ query: `v=${cacheKey}` });
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets', 'main.css')).with({ query: `v=${cacheKey}` });
    return `<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
<link rel="stylesheet" href="${style}"></head><body data-view="commit"><div id="root"></div><script type="module" src="${script}"></script></body></html>`;
  }
}

export function stagedChanges(changes: readonly GitChange[]): GitChange[] {
  return changes.filter(change => !change.conflict && change.index !== null);
}
