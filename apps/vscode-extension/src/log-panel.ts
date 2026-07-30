import * as vscode from 'vscode';
import type { CommitDetails, CommitFileChange, CommitSummary, GitRef } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';

type CommitAction = 'copyRevision' | 'copySubject' | 'createBranch' | 'createTag' | 'checkout' | 'cherryPick' | 'revert' | 'reset';
type RefAction = 'copy' | 'checkout' | 'createBranch' | 'compare' | 'merge';

export class LogPanel {
  private static readonly panels = new Map<string, LogPanel>();
  private readonly unsubscribe: () => void;
  private commits: CommitSummary[];
  private activeRef: string | null = null;
  private search = '';
  private selectedHash: string | null = null;
  private details: CommitDetails | null = null;
  private hasMore = false;
  private logLoading = false;
  private detailsLoading = false;
  private localError: string | null = null;
  private logRequest = 0;
  private detailsRequest = 0;
  private repositoryVersion: number;

  static show(context: vscode.ExtensionContext, repository: RepositoryController): void {
    const existing = this.panels.get(repository.root);
    if (existing) {
      existing.panel.reveal();
      existing.postSnapshot();
      return;
    }
    const panel = vscode.window.createWebviewPanel('git4vsc.log', `Git Log — ${repository.snapshot.status?.branch ?? 'HEAD'}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')]
    });
    this.panels.set(repository.root, new LogPanel(context, repository, panel));
  }

  private constructor(
    context: vscode.ExtensionContext,
    private readonly repository: RepositoryController,
    readonly panel: vscode.WebviewPanel
  ) {
    this.commits = [...repository.snapshot.commits];
    this.repositoryVersion = repository.snapshot.version;
    panel.webview.html = this.html(context, panel.webview);
    this.unsubscribe = repository.onDidChange(snapshot => {
      panel.title = `Git Log — ${snapshot.status?.branch ?? 'HEAD'}`;
      if (snapshot.version !== this.repositoryVersion) {
        this.repositoryVersion = snapshot.version;
        void this.loadLog(true);
      } else {
        this.postSnapshot();
      }
    });
    panel.webview.onDidReceiveMessage(message => void this.handleMessage(message));
    panel.onDidDispose(() => {
      this.logRequest += 1;
      this.detailsRequest += 1;
      this.unsubscribe();
      LogPanel.panels.delete(repository.root);
    });
    void this.loadLog(true);
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    const request = message as Record<string, unknown>;
    try {
      switch (request.type) {
        case 'ready': this.postSnapshot(); break;
        case 'refresh':
          this.repository.invalidate('status', 'log', 'refs');
          await this.repository.refresh();
          break;
        case 'loadMore': await this.loadLog(false); break;
        case 'selectRef': await this.selectRef(request.ref); break;
        case 'search': await this.setSearch(request.text); break;
        case 'selectCommit': await this.selectCommit(request.hash); break;
        case 'openCommitDiff': await this.openCommitDiff(request.hash, request.change); break;
        case 'commitAction': await this.commitAction(request.action, request.hash); break;
        case 'refAction': await this.refAction(request.action, request.fullName); break;
      }
    } catch (error) {
      this.localError = error instanceof Error ? error.message : String(error);
      this.postSnapshot();
      void vscode.window.showErrorMessage(`Git4VSC: ${this.localError}`);
    }
  }

  private async selectRef(value: unknown): Promise<void> {
    if (value !== null && value !== 'HEAD' && (typeof value !== 'string' || !this.findRef(value))) return;
    if (this.activeRef === value) return;
    this.activeRef = value as string | null;
    await this.loadLog(true);
  }

  private async setSearch(value: unknown): Promise<void> {
    if (typeof value !== 'string' || value === this.search) return;
    this.search = value;
    await this.loadLog(true);
  }

  private async loadLog(reset: boolean): Promise<void> {
    if (!reset && (this.logLoading || !this.hasMore)) return;
    const request = ++this.logRequest;
    this.logLoading = true;
    this.localError = null;
    if (reset) {
      this.selectedHash = null;
      this.details = null;
      this.detailsRequest += 1;
    }
    this.postSnapshot();
    try {
      const page = await this.repository.git.log(this.repository.location, reset ? 0 : this.commits.length, 200, {
        ...(this.activeRef ? { ref: this.activeRef } : {}),
        ...(this.search ? { text: this.search } : {})
      });
      if (request !== this.logRequest) return;
      const next = reset ? page.commits : [...this.commits, ...page.commits.filter(commit => !this.commits.some(existing => existing.hash === commit.hash))];
      this.commits = next;
      this.hasMore = page.hasMore;
      this.logLoading = false;
      this.postSnapshot();
      const first = next[0];
      if (reset && first) await this.loadDetails(first.hash);
    } catch (error) {
      if (request !== this.logRequest) return;
      this.logLoading = false;
      throw error;
    }
  }

  private async selectCommit(value: unknown): Promise<void> {
    if (typeof value !== 'string' || !this.findCommit(value) || value === this.selectedHash) return;
    await this.loadDetails(value);
  }

  private async loadDetails(hash: string): Promise<void> {
    const request = ++this.detailsRequest;
    this.selectedHash = hash;
    this.detailsLoading = true;
    this.details = null;
    this.postSnapshot();
    try {
      const details = await this.repository.git.commitDetails(this.repository.location, hash);
      if (request !== this.detailsRequest) return;
      this.details = details;
      this.detailsLoading = false;
      this.postSnapshot();
    } catch (error) {
      if (request !== this.detailsRequest) return;
      this.detailsLoading = false;
      throw error;
    }
  }

  private async openCommitDiff(hashValue: unknown, changeValue: unknown): Promise<void> {
    if (typeof hashValue !== 'string' || hashValue !== this.details?.hash || !changeValue || typeof changeValue !== 'object') return;
    const requested = changeValue as CommitFileChange;
    const change = this.details.files.find(file => file.path === requested.path && file.status === requested.status);
    if (!change) return;
    const parent = this.details.parents[0] ?? null;
    const leftPath = change.originalPath ?? change.path;
    const left = revisionUri(this.repository, leftPath, change.status === 'added' ? null : parent);
    const right = revisionUri(this.repository, change.path, change.status === 'deleted' ? null : this.details.hash);
    await vscode.commands.executeCommand('vscode.diff', left, right, `${change.path} (${this.details.hash.slice(0, 8)})`);
  }

  private async commitAction(actionValue: unknown, hashValue: unknown): Promise<void> {
    if (typeof actionValue !== 'string' || typeof hashValue !== 'string') return;
    const commit = this.findCommit(hashValue);
    if (!commit) return;
    const action = actionValue as CommitAction;
    if (action === 'copyRevision') return void await vscode.env.clipboard.writeText(commit.hash);
    if (action === 'copySubject') return void await vscode.env.clipboard.writeText(commit.subject);
    if (action === 'createBranch') {
      const name = await vscode.window.showInputBox({ title: `New Branch from ${commit.hash.slice(0, 8)}`, prompt: 'Branch name', validateInput: value => value.trim() ? undefined : 'Enter a branch name' });
      if (name) await this.repository.createBranch(name.trim(), commit.hash);
      return;
    }
    if (action === 'createTag') {
      const name = await vscode.window.showInputBox({ title: `New Tag at ${commit.hash.slice(0, 8)}`, prompt: 'Tag name', validateInput: value => value.trim() ? undefined : 'Enter a tag name' });
      if (name) await this.repository.createTag(name.trim(), commit.hash);
      return;
    }
    if (action === 'checkout') {
      const confirmed = await vscode.window.showWarningMessage(`Checkout ${commit.hash.slice(0, 8)} in detached HEAD mode?`, { modal: true }, 'Checkout');
      if (confirmed) await this.repository.checkout(commit.hash, true);
      return;
    }
    if (action === 'cherryPick') {
      const confirmed = await vscode.window.showWarningMessage(`Cherry-pick ${commit.hash.slice(0, 8)} onto the current branch?`, { modal: true }, 'Cherry-Pick');
      if (confirmed) await this.repository.cherryPick(commit.hash);
      return;
    }
    if (action === 'revert') {
      const confirmed = await vscode.window.showWarningMessage(`Create a new commit that reverts ${commit.hash.slice(0, 8)}?`, { modal: true }, 'Revert');
      if (confirmed) await this.repository.revert(commit.hash);
      return;
    }
    if (action === 'reset') await this.resetTo(commit.hash);
  }

  private async resetTo(hash: string): Promise<void> {
    const choice = await vscode.window.showQuickPick([
      { label: 'Soft', description: 'Move HEAD; keep index and working tree', mode: 'soft' as const },
      { label: 'Mixed', description: 'Move HEAD and reset index; keep working tree', mode: 'mixed' as const },
      { label: 'Hard', description: 'Discard index and working tree changes', mode: 'hard' as const }
    ], { title: `Reset current branch to ${hash.slice(0, 8)}` });
    if (!choice) return;
    if (choice.mode === 'hard') {
      const confirmed = await vscode.window.showWarningMessage('Hard reset permanently discards tracked working tree changes.', { modal: true }, 'Reset Hard');
      if (!confirmed) return;
    }
    await this.repository.reset(hash, choice.mode);
  }

  private async refAction(actionValue: unknown, fullNameValue: unknown): Promise<void> {
    if (typeof actionValue !== 'string') return;
    const ref = typeof fullNameValue === 'string' ? this.findRef(fullNameValue) : null;
    const action = actionValue as RefAction;
    if (action === 'copy') {
      await vscode.env.clipboard.writeText(ref?.name ?? this.repository.snapshot.status?.head ?? 'HEAD');
      return;
    }
    const startPoint = ref?.fullName ?? 'HEAD';
    if (action === 'createBranch') {
      const name = await vscode.window.showInputBox({ title: `New Branch from ${ref?.name ?? 'HEAD'}`, prompt: 'Branch name', validateInput: value => value.trim() ? undefined : 'Enter a branch name' });
      if (name) await this.repository.createBranch(name.trim(), startPoint);
      return;
    }
    if (!ref) return;
    if (action === 'compare') {
      await this.compareWithCurrent(ref);
      return;
    }
    if (action === 'checkout') {
      const dirty = (this.repository.snapshot.status?.changes.length ?? 0) > 0;
      const confirmed = dirty
        ? await vscode.window.showWarningMessage(`Checkout ${ref.name}? Local changes must be preserved by Git.`, { modal: true }, 'Checkout')
        : 'Checkout';
      if (!confirmed) return;
      await this.repository.checkout(ref.type === 'local-branch' ? ref.name : ref.name, ref.type === 'tag', ref.type === 'remote-branch');
      return;
    }
    if (action === 'merge') {
      const confirmed = await vscode.window.showWarningMessage(`Merge ${ref.name} into ${this.repository.snapshot.status?.branch ?? 'HEAD'}?`, { modal: true }, 'Merge');
      if (confirmed) await this.repository.merge(ref.fullName);
    }
  }

  private async compareWithCurrent(ref: GitRef): Promise<void> {
    const files = await this.repository.git.changedFiles(this.repository.location, ref.fullName, 'HEAD');
    if (files.length === 0) {
      void vscode.window.showInformationMessage(`${ref.name} has no file differences from the current branch.`);
      return;
    }
    const picked = await vscode.window.showQuickPick(files.map(change => ({
      label: change.path,
      description: change.status,
      change
    })), { title: `${ref.name} ↔ ${this.repository.snapshot.status?.branch ?? 'HEAD'} (${files.length} files)`, placeHolder: 'Select a file to open its diff' });
    if (!picked) return;
    const change = picked.change;
    const leftPath = change.originalPath ?? change.path;
    const left = revisionUri(this.repository, leftPath, change.status === 'added' ? null : ref.fullName);
    const right = revisionUri(this.repository, change.path, change.status === 'deleted' ? null : 'HEAD');
    await vscode.commands.executeCommand('vscode.diff', left, right, `${change.path} (${ref.name} ↔ HEAD)`);
  }

  private findCommit(hash: string): CommitSummary | undefined {
    return this.commits.find(commit => commit.hash === hash);
  }

  private findRef(fullName: string): GitRef | undefined {
    return this.repository.snapshot.status?.refs.find(ref => ref.fullName === fullName);
  }

  private postSnapshot(): void {
    const snapshot = this.repository.snapshot;
    void this.panel.webview.postMessage({
      type: 'snapshot',
      state: {
        status: snapshot.status,
        commits: this.commits,
        activeRef: this.activeRef,
        search: this.search,
        selectedHash: this.selectedHash,
        details: this.details,
        hasMore: this.hasMore,
        loading: this.logLoading || snapshot.loading.size > 0 || snapshot.operation !== null,
        detailsLoading: this.detailsLoading,
        error: this.localError ?? snapshot.error
      }
    });
  }

  private html(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const cacheKey = `${context.extension.packageJSON.version}-${Date.now()}`;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'assets', 'main.js')).with({ query: `v=${cacheKey}` });
    const style = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'assets', 'main.css')).with({ query: `v=${cacheKey}` });
    return `<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
<link rel="stylesheet" href="${style}"></head><body><div id="root"></div><script type="module" src="${script}"></script></body></html>`;
  }
}

function revisionUri(repository: RepositoryController, path: string, revision: string | null): vscode.Uri {
  return vscode.Uri.from({
    scheme: 'git4vsc',
    path: `/${revision ?? 'empty'}/${path.replaceAll('\\', '/')}`,
    query: encodeURIComponent(JSON.stringify({ root: repository.root, path, revision }))
  });
}
