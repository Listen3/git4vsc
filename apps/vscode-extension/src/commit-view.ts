import path from 'node:path';
import * as vscode from 'vscode';
import type { GitChange } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';
import { AiRequestCancelledError, aiIsConfigured, generateAiCommitMessage, onDidChangeAiSettings } from './ai-settings.js';
import { gitResourceUri } from './git-uri.js';
import { operationActivity } from './repository-status.js';
import { readGeneralSettings } from './settings.js';

interface CommitViewActions {
  commit(repository: RepositoryController, message: string, paths: readonly string[]): Promise<boolean>;
}

interface CommitViewMessage {
  type: 'ready' | 'selectRepository' | 'message' | 'select' | 'replaceSelection' | 'openChange' | 'resolveConflict' | 'rollback' | 'rollbackFile' | 'deleteFile' | 'jumpToSource' | 'addToVcs' | 'addToIgnore' | 'openAiSettings' | 'generateCommitMessage' | 'cancelCommitMessage' | 'commit';
  root?: string;
  message?: string;
  paths?: string[];
  path?: string;
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
    const aiConfigured = await aiIsConfigured(this.context);
    if (!this.view) return;
    const repositories = this.repositories();
    const repository = repositories.find(candidate => candidate.root === this.activeRoot) ?? repositories[0];
    this.activeRoot = repository?.root ?? null;
    if (repository && !this.messages.has(repository.root)) {
      this.messages.set(repository.root, this.context.workspaceState.get<string>(this.messageKey(repository.root)) ?? '');
    }
    const selection = repository ? this.selection(repository) : new Set<string>();
    const operation = repository?.snapshot.operation ?? null;
    const loading = repository?.snapshot.loading.has('status') ?? false;
    const showOperationProgress = readGeneralSettings().showOperationProgress;
    this.view.title = repository ? `Commit — ${repository.snapshot.status?.branch ?? 'HEAD'}` : 'Commit';
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
        aiGenerating: repository ? this.aiRequests.has(repository.root) : false
      }
    });
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
    if (message.type === 'commit') {
      const value = (message.message ?? this.messages.get(repository.root) ?? '').trim();
      const selected = this.selection(repository);
      const paths = [...new Set((repository.snapshot.status?.changes ?? []).flatMap(change => selected.has(change.path)
        ? [change.path, ...((change.index === 'renamed' || change.workingTree === 'renamed') && change.originalPath ? [change.originalPath] : [])]
        : []))];
      if (await this.actions.commit(repository, value, paths)) {
        this.selections.set(repository.root, new Set());
        this.messages.set(repository.root, '');
        await this.context.workspaceState.update(this.messageKey(repository.root), '');
        this.refresh();
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
