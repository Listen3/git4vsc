import { basename, isAbsolute, join, relative } from 'node:path';
import * as vscode from 'vscode';
import type { CommitDetails, CommitFileChange, CommitSummary, DialogListItem, GitRef, LogFilters } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';
import { emptyLogFilters, logQueryFromFilters, logUsers } from './log-filters.js';
import { selectionAfterLogReload } from './log-selection.js';
import { WebviewDialogController } from './webview-dialog-controller.js';

type CommitAction = 'copyRevision' | 'copySubject' | 'createBranch' | 'createTag' | 'checkout' | 'compareLocal' | 'cherryPick' | 'revert' | 'reset';
type RefAction =
  | 'copy' | 'toggleFavorite'
  | 'checkout' | 'checkoutUpdate' | 'checkoutRebase' | 'checkoutNew' | 'createBranch' | 'createTag' | 'newWorktree'
  | 'compare' | 'diffLocal' | 'rebaseOnto' | 'merge'
  | 'update' | 'push' | 'setUpstream' | 'pullMerge' | 'pullRebase'
  | 'rename' | 'delete';
type RemoteAction = 'fetch' | 'add' | 'edit' | 'remove';

export class LogPanel implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | null = null;
  private repository: RepositoryController | null = null;
  private session: LogSession | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly defaultRepository: () => RepositoryController | undefined
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.repository ??= this.defaultRepository() ?? null;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')]
    };
    view.onDidDispose(() => {
      this.session?.dispose();
      this.session = null;
      this.view = null;
    });
    this.attach();
  }

  async show(repository: RepositoryController): Promise<void> {
    this.repository = repository;
    this.attach();
    await vscode.commands.executeCommand('git4vsc.logView.focus');
    this.view?.show(true);
    if (!this.session) this.attach();
  }

  toggle(repository: RepositoryController): void {
    if (this.view?.visible && this.repository === repository) {
      void vscode.commands.executeCommand('workbench.action.closePanel');
    } else {
      void this.show(repository);
    }
  }

  async previewPush(repository: RepositoryController, branch: string, remote: string, upstream?: string): Promise<void> {
    await this.show(repository);
    if (!this.session) throw new Error('Git Log view is unavailable.');
    await this.session.previewPush(branch, remote, upstream);
  }

  initialize(repository: RepositoryController | undefined): void {
    if (this.repository || !repository) return;
    this.repository = repository;
    this.attach();
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
  }

  private attach(): void {
    if (!this.view || !this.repository) return;
    this.session?.dispose();
    this.session = new LogSession(this.context, this.repository, this.view);
  }
}

class LogSession implements vscode.Disposable {
  private readonly unsubscribe: () => void;
  private readonly messageSubscription: vscode.Disposable;
  private commits: CommitSummary[];
  private activeRef: string | null = null;
  private filters: LogFilters = { ...emptyLogFilters };
  private users: string[];
  private selectedHash: string | null = null;
  private details: CommitDetails | null = null;
  private hasMore = false;
  private logLoading = false;
  private detailsLoading = false;
  private localError: string | null = null;
  private logRequest = 0;
  private detailsRequest = 0;
  private repositoryVersion: number;
  private readonly favoriteRefs: Set<string>;
  private readonly dialogs: WebviewDialogController;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repository: RepositoryController,
    private readonly view: vscode.WebviewView
  ) {
    this.commits = [...repository.snapshot.commits];
    this.users = logUsers(this.commits);
    this.repositoryVersion = repository.snapshot.version;
    this.favoriteRefs = new Set(context.workspaceState.get<string[]>(this.favoriteKey(), []));
    this.dialogs = new WebviewDialogController(message => view.webview.postMessage(message));
    view.title = `Git Log — ${repository.snapshot.status?.branch ?? 'HEAD'}`;
    view.webview.html = this.html(context, view.webview);
    this.unsubscribe = repository.onDidChange(snapshot => {
      view.title = `Git Log — ${snapshot.status?.branch ?? 'HEAD'}`;
      if (snapshot.version !== this.repositoryVersion) {
        this.repositoryVersion = snapshot.version;
        this.users = logUsers(snapshot.commits, this.users);
        void this.loadLog(true);
      } else {
        this.postSnapshot();
      }
    });
    this.messageSubscription = view.webview.onDidReceiveMessage(message => void this.handleMessage(message));
    void this.loadLog(true);
  }

  dispose(): void {
    this.logRequest += 1;
    this.detailsRequest += 1;
    this.unsubscribe();
    this.messageSubscription.dispose();
    this.dialogs.cancel();
  }

  async previewPush(branch: string, remote: string, upstream?: string): Promise<void> {
    const commits = await this.repository.git.outgoingCommits(this.repository.location, branch, remote, upstream);
    if (!commits.length) {
      void vscode.window.showInformationMessage(`${branch} is up to date with ${remote}.`);
      return;
    }
    const preview = await Promise.all(commits.map(async commit => ({ commit, files: (await this.repository.git.commitDetails(this.repository.location, commit.hash)).files })));
    const action = await this.dialogs.show({
      kind: 'push-preview',
      title: `Push Commits to ${basename(this.repository.root)}`,
      source: branch,
      target: `${remote}/${branch}`,
      commits: preview
    });
    if (action === 'push') await this.repository.pushBranch(branch, remote);
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
        case 'filters': await this.setFilters(request.filters); break;
        case 'pickPaths': await this.pickPaths(request.kind); break;
        case 'selectCommit': await this.selectCommit(request.hash); break;
        case 'openCommitDiff': await this.openCommitDiff(request.hash, request.change); break;
        case 'revertCommitChanges': await this.revertCommitChanges(request.hash, request.paths); break;
        case 'commitAction': await this.commitAction(request.action, request.hash); break;
        case 'refAction': await this.refAction(request.action, request.fullName); break;
        case 'remoteAction': await this.remoteAction(request.action, request.remote); break;
        case 'dialog:result': this.dialogs.resolve(request.id, request.value); break;
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

  private async setFilters(value: unknown): Promise<void> {
    if (!isLogFilters(value) || JSON.stringify(value) === JSON.stringify(this.filters)) return;
    this.filters = value;
    await this.loadLog(true);
  }

  private async pickPaths(value: unknown): Promise<void> {
    if (value !== 'files' && value !== 'folder') return;
    const picked = await vscode.window.showOpenDialog({
      title: value === 'files' ? 'Select Files to Filter Git Log' : 'Select Folder to Filter Git Log',
      defaultUri: vscode.Uri.file(this.repository.root),
      canSelectFiles: value === 'files',
      canSelectFolders: value === 'folder',
      canSelectMany: true,
      openLabel: 'Filter'
    });
    if (!picked?.length) return;
    const paths = picked.map(uri => relative(this.repository.root, uri.fsPath)).filter(path => !path.startsWith('..') && !isAbsolute(path)).map(path => (path || '.').replaceAll('\\', '/'));
    if (paths.length) await this.setFilters({ ...this.filters, path: [...new Set(paths)].join(', ') });
  }

  private async loadLog(reset: boolean): Promise<void> {
    if (!reset && (this.logLoading || !this.hasMore)) return;
    const request = ++this.logRequest;
    const limit = reset ? Math.max(200, this.commits.length) : 200;
    this.logLoading = true;
    this.localError = null;
    this.postSnapshot();
    try {
      const page = await this.repository.git.log(this.repository.location, reset ? 0 : this.commits.length, limit, logQueryFromFilters(this.filters, this.activeRef));
      if (request !== this.logRequest) return;
      const next = reset ? page.commits : [...this.commits, ...page.commits.filter(commit => !this.commits.some(existing => existing.hash === commit.hash))];
      this.commits = next;
      this.users = logUsers(next, this.users);
      this.hasMore = page.hasMore;
      this.logLoading = false;
      if (!reset) {
        this.postSnapshot();
        return;
      }
      const nextSelection = selectionAfterLogReload(next, this.selectedHash);
      if (!nextSelection) {
        this.detailsRequest += 1;
        this.selectedHash = null;
        this.details = null;
        this.detailsLoading = false;
        this.postSnapshot();
      } else if (nextSelection !== this.selectedHash || (!this.detailsLoading && this.details?.hash !== nextSelection)) {
        await this.loadDetails(nextSelection);
      } else {
        this.postSnapshot();
      }
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

  private async revertCommitChanges(hashValue: unknown, pathsValue: unknown): Promise<void> {
    if (typeof hashValue !== 'string' || hashValue !== this.details?.hash || !Array.isArray(pathsValue)) return;
    const paths = new Set(pathsValue.filter((path): path is string => typeof path === 'string'));
    const changes = this.details.files.filter(change => paths.has(change.path));
    if (!changes.length) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Revert ${changes.length} selected change${changes.length === 1 ? '' : 's'} from ${this.details.hash.slice(0, 8)}?`,
      { modal: true, detail: 'The inverse changes will be applied to the working tree without creating a commit.' },
      'Revert Changes'
    );
    if (confirmed) await this.repository.revertCommitChanges(this.details.parents[0] ?? null, this.details.hash, changes);
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
    if (action === 'compareLocal') {
      await this.compareCommitWithLocal(commit);
      return;
    }
    if (action === 'cherryPick') {
      const confirmed = await vscode.window.showWarningMessage(`Cherry-pick ${commit.hash.slice(0, 8)} onto the current branch?`, { modal: true }, 'Cherry-Pick');
      if (confirmed) {
        await this.repository.cherryPick(commit.hash);
        await this.resolveConflictsIfNeeded();
      }
      return;
    }
    if (action === 'revert') {
      const confirmed = await vscode.window.showWarningMessage(`Create a new commit that reverts ${commit.hash.slice(0, 8)}?`, { modal: true }, 'Revert');
      if (confirmed) {
        await this.repository.revert(commit.hash);
        await this.resolveConflictsIfNeeded();
      }
      return;
    }
    if (action === 'reset') await this.resetTo(commit.hash);
  }

  private async compareCommitWithLocal(commit: CommitSummary): Promise<void> {
    const files = await this.repository.git.changedFiles(this.repository.location, commit.hash);
    if (files.length === 0) {
      void vscode.window.showInformationMessage(`${commit.hash.slice(0, 8)} has no file differences from the local working tree.`);
      return;
    }
    const path = await this.dialogs.show({
      kind: 'list', title: `${commit.hash.slice(0, 8)} ↔ Local (${files.length} files)`, placeholder: 'Select a file to open its diff',
      items: files.map(change => ({ id: change.path, label: change.path, description: change.status }))
    });
    const change = files.find(file => file.path === path);
    if (!change) return;
    const leftPath = change.originalPath ?? change.path;
    const left = revisionUri(this.repository, leftPath, change.status === 'added' ? null : commit.hash);
    const right = change.status === 'deleted' ? revisionUri(this.repository, change.path, null) : vscode.Uri.file(join(this.repository.root, change.path));
    await vscode.commands.executeCommand('vscode.diff', left, right, `${change.path} (${commit.hash.slice(0, 8)} ↔ Local)`);
  }

  private async resetTo(hash: string): Promise<void> {
    const mode = await this.dialogs.show({ kind: 'list', title: `Reset current branch to ${hash.slice(0, 8)}`, items: [
      { id: 'soft', label: 'Soft', description: 'Move HEAD; keep index and working tree' },
      { id: 'mixed', label: 'Mixed', description: 'Move HEAD and reset index; keep working tree' },
      { id: 'hard', label: 'Hard', description: 'Discard index and working tree changes' }
    ], acceptLabel: 'Reset' });
    if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') return;
    if (mode === 'hard') {
      const confirmed = await vscode.window.showWarningMessage('Hard reset permanently discards tracked working tree changes.', { modal: true }, 'Reset Hard');
      if (!confirmed) return;
    }
    await this.repository.reset(hash, mode);
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
    if (action === 'createTag') {
      const name = await vscode.window.showInputBox({ title: `New Tag from ${ref?.name ?? 'HEAD'}`, prompt: 'Tag name', validateInput: value => value.trim() ? undefined : 'Enter a tag name' });
      if (name) await this.repository.createTag(name.trim(), startPoint);
      return;
    }
    if (action === 'newWorktree') {
      await this.newWorktree(ref ?? null);
      return;
    }
    if (!ref) return;
    if (action === 'toggleFavorite') {
      if (this.favoriteRefs.has(ref.fullName)) this.favoriteRefs.delete(ref.fullName);
      else this.favoriteRefs.add(ref.fullName);
      await this.context.workspaceState.update(this.favoriteKey(), [...this.favoriteRefs]);
      this.postSnapshot();
      return;
    }
    if (action === 'checkoutNew') {
      const suggested = ref.type === 'remote-branch' ? ref.name.slice(ref.name.indexOf('/') + 1) : ref.name;
      const name = await this.branchName(`Checkout ${ref.name} as New Branch`, suggested);
      if (name) await this.repository.createAndCheckoutBranch(name, ref.fullName, ref.type === 'remote-branch');
      return;
    }
    if (action === 'checkoutUpdate') {
      if (ref.type !== 'local-branch') return;
      const upstream = await this.repository.git.branchUpstream(this.repository.location, ref.name);
      if (!upstream) {
        void vscode.window.showWarningMessage(`${ref.name} has no tracked branch.`);
        return;
      }
      await this.repository.checkoutAndUpdate(ref.name, upstream);
      return;
    }
    if (action === 'checkoutRebase') {
      const current = this.repository.snapshot.status?.branch;
      if (!current) return;
      const confirmed = await vscode.window.showWarningMessage(`Rebase ${ref.name} onto ${current} and check it out?`, { modal: true }, 'Checkout and Rebase');
      if (!confirmed) return;
      if (ref.type === 'local-branch') await this.repository.checkoutAndRebase(ref.name, current);
      else if (ref.type === 'remote-branch') {
        const local = await this.localBranchForRemote(ref);
        if (!local) return;
        if (local.exists) await this.repository.checkoutAndRebase(local.name, current);
        else await this.repository.checkoutRemoteAndRebase(local.name, ref.name, current);
      }
      return;
    }
    if (action === 'compare') {
      await this.compareRefCommits(ref);
      return;
    }
    if (action === 'diffLocal') {
      await this.showDiffWithCurrent(ref);
      return;
    }
    if (action === 'checkout') {
      const dirty = (this.repository.snapshot.status?.changes.length ?? 0) > 0;
      const confirmed = dirty
        ? await vscode.window.showWarningMessage(`Checkout ${ref.name}? Local changes must be preserved by Git.`, { modal: true }, 'Checkout')
        : 'Checkout';
      if (!confirmed) return;
      if (ref.type === 'remote-branch') {
        const local = await this.localBranchForRemote(ref);
        if (!local) return;
        if (local.exists) await this.repository.checkout(local.name);
        else await this.repository.createAndCheckoutBranch(local.name, ref.fullName, true);
      } else {
        await this.repository.checkout(ref.name, ref.type === 'tag');
      }
      return;
    }
    if (action === 'rebaseOnto') {
      const confirmed = await vscode.window.showWarningMessage(`Rebase ${this.repository.snapshot.status?.branch ?? 'HEAD'} onto ${ref.name}?`, { modal: true }, 'Rebase');
      if (confirmed) {
        await this.repository.rebase(ref.fullName);
        await this.resolveConflictsIfNeeded();
      }
      return;
    }
    if (action === 'merge') {
      const confirmed = await vscode.window.showWarningMessage(`Merge ${ref.name} into ${this.repository.snapshot.status?.branch ?? 'HEAD'}?`, { modal: true }, 'Merge');
      if (confirmed) {
        await this.repository.merge(ref.fullName);
        await this.resolveConflictsIfNeeded();
      }
      return;
    }
    if (action === 'update') await this.updateSelectedBranch(ref);
    else if (action === 'push') await this.pushRef(ref);
    else if (action === 'setUpstream') await this.setTrackedBranch(ref);
    else if (action === 'pullMerge' || action === 'pullRebase') await this.pullRemoteBranch(ref, action === 'pullRebase');
    else if (action === 'rename') await this.renameBranch(ref);
    else if (action === 'delete') await this.deleteRef(ref);
  }

  private async compareRefCommits(ref: GitRef): Promise<void> {
    const [selectedOnly, currentOnly] = await Promise.all([
      this.repository.git.log(this.repository.location, 0, 100, { ref: `HEAD..${ref.fullName}` }),
      this.repository.git.log(this.repository.location, 0, 100, { ref: `${ref.fullName}..HEAD` })
    ]);
    const items: DialogListItem[] = [
      { id: 'selected-only', label: `${ref.name} only`, separator: true },
      ...selectedOnly.commits.map(commit => ({ id: commit.hash, label: commit.subject, description: commit.hash.slice(0, 8), detail: commit.authorName })),
      { id: 'current-only', label: `${this.repository.snapshot.status?.branch ?? 'HEAD'} only`, separator: true },
      ...currentOnly.commits.map(commit => ({ id: commit.hash, label: commit.subject, description: commit.hash.slice(0, 8), detail: commit.authorName }))
    ];
    if (selectedOnly.commits.length + currentOnly.commits.length === 0) {
      void vscode.window.showInformationMessage(`${ref.name} and the current branch contain the same commits.`);
      return;
    }
    const hash = await this.dialogs.show({ kind: 'list', title: `Compare ${ref.name} with ${this.repository.snapshot.status?.branch ?? 'HEAD'}`, placeholder: 'Select a commit to show its details', items });
    if (hash && [...selectedOnly.commits, ...currentOnly.commits].some(commit => commit.hash === hash)) await this.loadDetails(hash);
  }

  private async showDiffWithCurrent(ref: GitRef): Promise<void> {
    const files = await this.repository.git.changedFiles(this.repository.location, ref.fullName);
    if (files.length === 0) {
      void vscode.window.showInformationMessage(`${ref.name} has no file differences from the local working tree.`);
      return;
    }
    const path = await this.dialogs.show({
      kind: 'list', title: `${ref.name} ↔ Local (${files.length} files)`, placeholder: 'Select a file to open its diff',
      items: files.map(change => ({ id: change.path, label: change.path, description: change.status }))
    });
    const change = files.find(file => file.path === path);
    if (!change) return;
    const leftPath = change.originalPath ?? change.path;
    const left = revisionUri(this.repository, leftPath, change.status === 'added' ? null : ref.fullName);
    const right = change.status === 'deleted' ? revisionUri(this.repository, change.path, null) : vscode.Uri.file(join(this.repository.root, change.path));
    await vscode.commands.executeCommand('vscode.diff', left, right, `${change.path} (${ref.name} ↔ Local)`);
  }

  private async localBranchForRemote(ref: GitRef): Promise<{ name: string; exists: boolean } | undefined> {
    const name = ref.name.slice(ref.name.indexOf('/') + 1);
    const local = this.repository.snapshot.status?.refs.find(candidate => candidate.type === 'local-branch' && candidate.name === name);
    if (!local) return { name, exists: false };
    if (await this.repository.git.branchUpstream(this.repository.location, name) === ref.name) return { name, exists: true };
    const replacement = await this.branchName(`Local branch ${name} already tracks another branch`, `${ref.remote ?? 'remote'}-${name}`);
    return replacement ? { name: replacement, exists: false } : undefined;
  }

  private async updateSelectedBranch(ref: GitRef): Promise<void> {
    if (ref.type !== 'local-branch') return;
    const upstream = await this.repository.git.branchUpstream(this.repository.location, ref.name);
    if (!upstream) {
      void vscode.window.showWarningMessage(`${ref.name} has no tracked branch. Use “Set Tracked Branch” first.`);
      return;
    }
    if (ref.name === this.repository.snapshot.status?.branch) {
      const [remote, branch] = splitRemoteBranch(upstream);
      const strategy = await this.dialogs.show({ kind: 'list', title: 'Update Project', items: [
        { id: 'merge', label: 'Merge incoming changes into the current branch', description: 'Default' },
        { id: 'rebase', label: 'Rebase the current branch on top of incoming changes' }
      ], acceptLabel: 'Update' });
      if (strategy !== 'merge' && strategy !== 'rebase') return;
      await this.repository.pullBranch(remote, branch, strategy === 'rebase');
    }
    else await this.repository.updateBranch(ref.name, upstream);
  }

  private async pushRef(ref: GitRef): Promise<void> {
    const upstream = ref.type === 'local-branch' ? await this.repository.git.branchUpstream(this.repository.location, ref.name) : null;
    const preferredRemote = upstream?.split('/', 1)[0];
    const remote = await this.pickRemote(ref.type === 'tag' ? `Push Tag ${ref.name}` : `Push Branch ${ref.name}`, preferredRemote);
    if (!remote) return;
    if (ref.type === 'tag') await this.repository.pushTag(ref.name, remote);
    else if (ref.type === 'local-branch') await this.previewPush(ref.name, remote, upstream ?? undefined);
  }

  private async setTrackedBranch(ref: GitRef): Promise<void> {
    if (ref.type !== 'local-branch') return;
    const choices = this.repository.snapshot.status?.refs.filter(candidate => candidate.type === 'remote-branch') ?? [];
    const fullName = await this.dialogs.show({ kind: 'list', title: `Tracked Branch for ${ref.name}`, placeholder: 'Search remote branches', items: choices.map(candidate => ({ id: candidate.fullName, label: candidate.name, ...(candidate.remote ? { description: candidate.remote } : {}) })) });
    const picked = choices.find(candidate => candidate.fullName === fullName);
    if (picked) await this.repository.setUpstream(ref.name, picked.name);
  }

  private async pullRemoteBranch(ref: GitRef, rebase: boolean): Promise<void> {
    if (ref.type !== 'remote-branch') return;
    const [remote, branch] = splitRemoteBranch(ref.name);
    const method = rebase ? 'rebase' : 'merge';
    const confirmed = await vscode.window.showWarningMessage(`Pull ${ref.name} into ${this.repository.snapshot.status?.branch ?? 'HEAD'} using ${method}?`, { modal: true }, 'Pull');
    if (confirmed) {
      await this.repository.pullBranch(remote, branch, rebase);
      await this.resolveConflictsIfNeeded();
    }
  }

  private async resolveConflictsIfNeeded(): Promise<void> {
    if (this.repository.snapshot.status?.changes.some(change => change.conflict)) {
      await vscode.commands.executeCommand('git4vsc.resolveConflicts', this.repository);
    }
  }

  private async renameBranch(ref: GitRef): Promise<void> {
    if (ref.type !== 'local-branch') return;
    const name = await this.branchName(`Rename Branch ${ref.name}`, ref.name);
    if (name && name !== ref.name) await this.repository.renameBranch(ref.name, name);
  }

  private async deleteRef(ref: GitRef): Promise<void> {
    if (ref.type === 'local-branch') {
      const choice = await vscode.window.showWarningMessage(`Delete local branch ${ref.name}?`, { modal: true, detail: 'Normal delete refuses to remove an unmerged branch. Force delete discards the branch ref even when unmerged.' }, 'Delete', 'Force Delete');
      if (choice) await this.repository.deleteBranch(ref.name, choice === 'Force Delete');
      return;
    }
    if (ref.type === 'remote-branch') {
      const [remote, branch] = splitRemoteBranch(ref.name);
      const confirmed = await vscode.window.showWarningMessage(`Delete ${branch} from remote ${remote}?`, { modal: true, detail: 'This changes the shared remote repository.' }, 'Delete Remote Branch');
      if (confirmed) await this.repository.deleteRemoteBranch(remote, branch);
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(`Delete local tag ${ref.name}?`, { modal: true }, 'Delete Tag');
    if (confirmed) await this.repository.deleteTag(ref.name);
  }

  private async newWorktree(ref: GitRef | null): Promise<void> {
    const mode = await this.dialogs.show({ kind: 'list', title: `New Worktree for ${ref?.name ?? 'HEAD'}`, items: [
      { id: 'branch', label: 'Create New Branch', description: 'Create and check out a new branch in the worktree' },
      { id: 'detached', label: 'Detached HEAD', description: 'Open the selected revision without owning a branch' }
    ], acceptLabel: 'Continue' });
    if (mode !== 'branch' && mode !== 'detached') return;
    const newBranch = mode === 'branch' ? await this.branchName('New Worktree Branch') : undefined;
    if (mode === 'branch' && !newBranch) return;
    const target = await vscode.window.showOpenDialog({ title: `New Worktree for ${ref?.name ?? 'HEAD'}`, canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Use Empty Folder' });
    const path = target?.[0]?.fsPath;
    if (path) await this.repository.addWorktree(path, ref?.fullName ?? 'HEAD', newBranch);
  }

  private async branchName(title: string, value?: string): Promise<string | undefined> {
    const name = await vscode.window.showInputBox({ title, ...(value ? { value } : {}), prompt: 'Branch name', validateInput: input => input.trim() ? undefined : 'Enter a branch name' });
    return name?.trim() || undefined;
  }

  private async pickRemote(title: string, preferred?: string): Promise<string | undefined> {
    const remotes = await this.repository.git.remotes(this.repository.location);
    if (remotes.length === 0) {
      void vscode.window.showWarningMessage('This repository has no configured remotes.');
      return undefined;
    }
    if (remotes.length === 1) return remotes[0];
    const selected = await this.dialogs.show({ kind: 'list', title, items: remotes.map(remote => ({ id: remote, label: remote, ...(remote === preferred ? { description: 'current upstream' } : {}) })) });
    return remotes.includes(selected ?? '') ? selected ?? undefined : undefined;
  }

  private async remoteAction(actionValue: unknown, remoteValue: unknown): Promise<void> {
    if (typeof actionValue !== 'string') return;
    const action = actionValue as RemoteAction;
    const remote = typeof remoteValue === 'string' ? remoteValue : null;
    if (action === 'fetch') {
      await this.repository.fetchRemote(remote ?? undefined);
      return;
    }
    if (action === 'add') {
      const name = await vscode.window.showInputBox({ title: 'Add Git Remote', prompt: 'Remote name', validateInput: value => value.trim() ? undefined : 'Enter a remote name' });
      if (!name) return;
      const url = await vscode.window.showInputBox({ title: `URL for ${name.trim()}`, prompt: 'Remote URL', validateInput: value => value.trim() ? undefined : 'Enter a remote URL' });
      if (url) await this.repository.addRemote(name.trim(), url.trim());
      return;
    }
    if (!remote) return;
    if (action === 'edit') {
      const currentUrl = await this.repository.git.remoteUrl(this.repository.location, remote);
      const url = await vscode.window.showInputBox({ title: `Edit Remote ${remote}`, value: currentUrl, prompt: 'Remote URL', validateInput: value => value.trim() ? undefined : 'Enter a remote URL' });
      if (url && url.trim() !== currentUrl) await this.repository.setRemoteUrl(remote, url.trim());
      return;
    }
    if (action === 'remove') {
      const confirmed = await vscode.window.showWarningMessage(`Remove remote ${remote}?`, { modal: true, detail: 'This removes the local remote configuration and its remote-tracking refs. It does not delete the remote repository.' }, 'Remove Remote');
      if (confirmed) await this.repository.removeRemote(remote);
    }
  }

  private favoriteKey(): string {
    return `git4vsc.favoriteRefs:${this.repository.root}`;
  }

  private findCommit(hash: string): CommitSummary | undefined {
    return this.commits.find(commit => commit.hash === hash);
  }

  private findRef(fullName: string): GitRef | undefined {
    return this.repository.snapshot.status?.refs.find(ref => ref.fullName === fullName);
  }

  private postSnapshot(): void {
    const snapshot = this.repository.snapshot;
    void this.view.webview.postMessage({
      type: 'snapshot',
      state: {
        status: snapshot.status,
        commits: this.commits,
        activeRef: this.activeRef,
        favoriteRefs: [...this.favoriteRefs],
        filters: this.filters,
        users: this.users,
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

function splitRemoteBranch(value: string): [string, string] {
  const separator = value.indexOf('/');
  if (separator < 1) throw new Error(`Invalid remote branch: ${value}`);
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function isLogFilters(value: unknown): value is LogFilters {
  if (!value || typeof value !== 'object') return false;
  const filters = value as Record<string, unknown>;
  return typeof filters.text === 'string' && typeof filters.user === 'string' && typeof filters.path === 'string'
    && ['all', 'today', 'yesterday', 'week', 'month'].includes(String(filters.date));
}
