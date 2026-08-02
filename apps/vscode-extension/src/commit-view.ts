import path from 'node:path';
import * as vscode from 'vscode';
import type { CommitFileChange, GitChange, PushPreviewDialogRequest } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';
import { AiRequestCancelledError, aiIsConfigured, generateAiCommitMessage, onDidChangeAiSettings } from './ai-settings.js';
import { gitResourceUri } from './git-uri.js';
import { branchTrackingSuffix, operationActivity } from './repository-status.js';
import { readGeneralSettings } from './settings.js';
import { notifyPushResult, resultNotificationsEnabled } from './operation-notifications.js';

interface CommitViewActions {
  commit(repository: RepositoryController, message: string, paths: readonly string[]): Promise<boolean>;
  push(repository: RepositoryController): Promise<void>;
}

interface CommitViewMessage {
  type: 'ready' | 'selectRepository' | 'message' | 'select' | 'replaceSelection' | 'openChange' | 'resolveConflict' | 'rollback' | 'rollbackFile' | 'deleteFile' | 'jumpToSource' | 'addToVcs' | 'addToIgnore' | 'openAiSettings' | 'generateCommitMessage' | 'cancelCommitMessage' | 'commit' | 'commitAndPush' | 'closePushPreview' | 'openPushPreviewDiff' | 'pushPreview';
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
}

export class CommitView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | null = null;
  private activeRoot: string | null;
  private readonly messages = new Map<string, string>();
  private readonly selections = new Map<string, Set<string>>();
  private readonly aiRequests = new Map<string, AbortController>();
  private readonly aiSettingsSubscription: vscode.Disposable;
  private pushPreview: PushPreviewDialogRequest | null = null;
  private pushPreviewRemote: string | null = null;

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
    void this.postSnapshot();
  }

  private async postSnapshot(): Promise<void> {
    if (!this.view) return;
    const repositories = this.repositories();
    const repository = repositories.find(candidate => candidate.root === this.activeRoot) ?? repositories[0];
    this.activeRoot = repository?.root ?? null;
    const status = repository?.snapshot.status;
    void vscode.commands.executeCommand('setContext', 'git4vsc.hasIncoming', Boolean(status?.upstream && status.behind));
    void vscode.commands.executeCommand('setContext', 'git4vsc.hasOutgoing', Boolean(status?.upstream && status.ahead));
    const aiConfigured = await aiIsConfigured(this.context);
    if (!this.view) return;
    if (repository && !this.messages.has(repository.root)) {
      this.messages.set(repository.root, this.context.workspaceState.get<string>(this.messageKey(repository.root)) ?? '');
    }
    const selection = repository ? this.selection(repository) : new Set<string>();
    const operation = repository?.snapshot.operation ?? null;
    const loading = repository?.snapshot.loading.has('status') ?? false;
    const showOperationProgress = readGeneralSettings().showOperationProgress;
    const branch = status?.branch ?? status?.head?.slice(0, 8) ?? 'HEAD';
    const tracking = branchTrackingSuffix(status);
    this.view.title = repository ? `${this.pushPreview ? 'Push' : 'Commit'} — ${branch}${tracking ? ` ${tracking}` : ''}` : 'Commit';
    const ahead = status?.upstream ? status.ahead : 0;
    this.view.badge = ahead ? { value: ahead, tooltip: `${ahead} commit${ahead === 1 ? '' : 's'} ready to push` } : undefined;
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
        selectedPaths: [...selection],
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
      return Promise.all(commits.map(async commit => ({
        commit,
        files: (await repository.git.commitDetails(repository.location, commit.hash)).files
      })));
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
      commits: preview
    };
    this.pushPreviewRemote = remote;
    await this.show(repository);
  }

  async show(repository: RepositoryController): Promise<void> {
    this.activeRoot = repository.root;
    await this.context.workspaceState.update('git4vsc.commit.activeRoot', repository.root);
    await vscode.commands.executeCommand('workbench.view.extension.git4vsc');
    await vscode.commands.executeCommand('git4vsc.repositories.focus');
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
      this.pushPreview = null;
      this.pushPreviewRemote = null;
      this.activeRoot = message.root;
      await this.context.workspaceState.update('git4vsc.commit.activeRoot', message.root);
      return this.refresh();
    }
    if (message.type === 'openAiSettings') {
      await vscode.commands.executeCommand('git4vsc.openSettings', 'ai');
      return;
    }

    const repository = this.activeRepository();
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
      await repository.pushBranch(preview.source, this.pushPreviewRemote, targetBranch, Boolean(message.force));
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
      for (const path of message.paths) {
        if (message.selected) selection.add(path);
        else selection.delete(path);
      }
      return this.refresh();
    }
    if (message.type === 'replaceSelection' && message.paths?.length) {
      this.selections.set(repository.root, new Set(message.paths));
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
      const requested = message.type === 'rollbackFile' && message.path ? new Set([message.path]) : selected;
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
    if (message.type === 'addToVcs' && message.path) {
      await repository.stage([message.path]);
      this.selection(repository).add(message.path);
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
      const paths = [...new Set((repository.snapshot.status?.changes ?? []).flatMap(change => selected.has(change.path)
        ? [change.path, ...((change.index === 'renamed' || change.workingTree === 'renamed') && change.originalPath ? [change.originalPath] : [])]
        : []))];
      if (await this.actions.commit(repository, value, paths)) {
        this.selections.set(repository.root, new Set());
        this.messages.set(repository.root, '');
        await this.context.workspaceState.update(this.messageKey(repository.root), '');
        if (message.type === 'commitAndPush') await this.actions.push(repository);
        else this.refresh();
      }
    }
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

  private activeRepository(): RepositoryController | undefined {
    return this.repositories().find(repository => repository.root === this.activeRoot) ?? this.repositories()[0];
  }

  private selection(repository: RepositoryController): Set<string> {
    const changes = repository.snapshot.status?.changes.filter(change => !change.conflict) ?? [];
    const existing = this.selections.get(repository.root);
    if (!existing) {
      const initial = new Set(changes.filter(change => change.index !== null).map(change => change.path));
      this.selections.set(repository.root, initial);
      return initial;
    }
    const paths = new Set(changes.map(change => change.path));
    for (const path of existing) if (!paths.has(path)) existing.delete(path);
    return existing;
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
