import { readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import * as vscode from 'vscode';
import type { CommitDetails, CommitFileChange, CommitSummary, DialogListItem, GitRef, LogFilters, PathTreeEntry, RepositoryStatus } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';
import { emptyLogFilters, logQueryFromFilters, logUsers } from './log-filters.js';
import { selectionAfterLogReload } from './log-selection.js';
import { WebviewDialogController } from './webview-dialog-controller.js';
import { notifyFetchResult, notifyUpdateResult, resultNotificationsEnabled } from './operation-notifications.js';
import { operationActivity } from './repository-status.js';
import { readGeneralSettings } from './settings.js';
import { configuredUpdateStrategy } from './update-strategy.js';
import { checkoutWithSmartFallback, createAndCheckoutWithSmartFallback, runSmartCheckoutFallback, updateWithSmartFallback } from './smart-operations.js';
import { LogCache } from './log-cache.js';
import { worktreePath } from './worktree-path.js';
import { checkedOutBranchRepository, refreshAfterLinkedWorktreeUpdate } from './worktree-update.js';

type CommitAction = 'copyRevision' | 'copySubject' | 'createBranch' | 'createTag' | 'checkout' | 'compareLocal' | 'cherryPick' | 'revert' | 'reset';
type CommitFileAction =
  | 'showDiff' | 'showDiffNewTab' | 'compareLocal' | 'compareBeforeLocal'
  | 'editSource' | 'openRepositoryVersion' | 'revertSelected' | 'cherryPickSelected'
  | 'createPatch' | 'getFromRevision' | 'historyUpToHere' | 'showChangesToParent' | 'copyPath';
type RefAction =
  | 'copy' | 'toggleFavorite'
  | 'checkout' | 'checkoutUpdate' | 'checkoutRebase' | 'checkoutNew' | 'createBranch' | 'createTag' | 'newWorktree' | 'openWorktree'
  | 'copyWorktreePath' | 'manageWorktrees' | 'lockWorktree' | 'unlockWorktree' | 'removeWorktree'
  | 'compare' | 'diffLocal' | 'rebaseOnto' | 'merge'
  | 'update' | 'push' | 'setUpstream' | 'pullMerge' | 'pullRebase'
  | 'rename' | 'delete';
type RemoteAction = 'fetch' | 'add' | 'edit' | 'remove';
type PreviewPush = (repository: RepositoryController, branch: string, remote: string, upstream?: string) => Promise<void>;
interface PersistedLogState { filters: LogFilters }

const logSearchHistoryKey = 'git4vsc.logSearchHistory';

export class LogPanel implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | null = null;
  private repository: RepositoryController | null = null;
  private session: LogSession | null = null;
  private pendingCommit: string | null = null;
  private readonly cache: LogCache;
  private prewarmTail = Promise.resolve();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly defaultRepository: () => RepositoryController | undefined,
    private readonly previewPush: PreviewPush,
    private readonly worktreesChanged: () => void = () => undefined
  ) {
    this.cache = new LogCache(context.storageUri?.fsPath);
  }

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
    const changed = this.repository !== repository;
    this.select(repository);
    if (!changed) this.session?.showLog();
    await vscode.commands.executeCommand('git4vsc.logView.focus');
    this.view?.show(true);
    if (!this.session) this.attach();
  }

  async showFileHistory(repository: RepositoryController, path: string): Promise<void> {
    const changed = this.repository !== repository;
    this.repository = repository;
    if (changed) this.attach(path);
    else this.session?.showFileHistory(path);
    await vscode.commands.executeCommand('git4vsc.logView.focus');
    this.view?.show(true);
    if (!this.session) this.attach(path);
    this.session?.showFileHistory(path);
  }

  select(repository: RepositoryController): void {
    const changed = this.repository !== repository;
    this.repository = repository;
    if (changed) this.attach();
  }

  toggle(repository: RepositoryController): void {
    if (this.view?.visible && this.repository === repository) {
      void vscode.commands.executeCommand('workbench.action.closePanel');
    } else {
      void this.show(repository);
    }
  }

  initialize(repository: RepositoryController | undefined): void {
    if (this.repository || !repository) return;
    this.repository = repository;
    this.attach();
  }

  refresh(): void {
    this.session?.refresh();
  }

  prewarm(repository: RepositoryController): void {
    this.prewarmTail = this.prewarmTail.then(async () => {
      await delay(2_000);
      if (this.session && this.repository === repository) return;
      const head = repository.snapshot.status?.head;
      if (!head || repository.snapshot.operation || await this.cache.read(repository.root, head)) return;
      const page = await repository.git.log(repository.location, 0, 100, { ref: head });
      if (repository.snapshot.status?.head === head) await this.cache.write(repository.root, head, page);
    }).catch(() => undefined);
  }

  revealCommit(repository: RepositoryController, hash: string): void {
    if (this.repository === repository) this.session?.revealCommit(hash);
  }

  async showCommit(repository: RepositoryController, hash: string): Promise<void> {
    const changed = this.repository !== repository;
    this.repository = repository;
    this.pendingCommit = hash;
    if (changed) this.attach();
    await vscode.commands.executeCommand('git4vsc.logView.focus');
    this.view?.show(true);
    if (!this.session) this.attach();
    await this.revealPendingCommit();
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
  }

  private attach(fileHistoryPath: string | null = null): void {
    if (!this.view || !this.repository) return;
    this.session?.dispose();
    this.session = new LogSession(this.context, this.repository, this.view, this.previewPush, this.cache, this.worktreesChanged, fileHistoryPath);
    void this.revealPendingCommit();
  }

  private async revealPendingCommit(): Promise<void> {
    const hash = this.pendingCommit;
    if (!hash || !this.session) return;
    this.pendingCommit = null;
    await this.session.showCommit(hash);
  }
}

class LogSession implements vscode.Disposable {
  private readonly unsubscribe: () => void;
  private readonly messageSubscription: vscode.Disposable;
  private commits: CommitSummary[];
  private activeRef: string | null;
  private filters: LogFilters;
  private mainFilters: LogFilters;
  private fileHistoryPath: string | null;
  private searchHistory: string[];
  private users: string[];
  private selectedHash: string | null = null;
  private details: CommitDetails | null = null;
  private hasMore = false;
  private logLoading = false;
  private quietLogLoading = false;
  private detailsLoading = false;
  private localError: string | null = null;
  private logRequest = 0;
  private commitNavigation = 0;
  private detailsRequest = 0;
  private prefetchTimer: NodeJS.Timeout | undefined;
  private preferredSelection: string | null = null;
  private logIdentity: string;
  private readonly detailsCache = new Map<string, CommitDetails>();
  private readonly detailsLoads = new Map<string, Promise<CommitDetails>>();
  private readonly favoriteRefs: Set<string>;
  private readonly dialogs: WebviewDialogController;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repository: RepositoryController,
    private readonly view: vscode.WebviewView,
    private readonly previewPush: PreviewPush,
    private readonly cache: LogCache,
    private readonly worktreesChanged: () => void,
    fileHistoryPath: string | null = null
  ) {
    const saved = context.workspaceState.get<Partial<PersistedLogState>>(this.stateKey());
    this.activeRef = 'HEAD';
    this.mainFilters = normalizeLogFilters(saved?.filters);
    this.fileHistoryPath = fileHistoryPath;
    this.filters = fileHistoryPath ? { ...emptyLogFilters, path: fileHistoryPath } : this.mainFilters;
    this.searchHistory = context.globalState.get<string[]>(logSearchHistoryKey, []);
    this.commits = [];
    this.users = [];
    this.logIdentity = repositoryLogIdentity(repository.snapshot.status);
    this.favoriteRefs = new Set(context.workspaceState.get<string[]>(this.favoriteKey(), []));
    this.dialogs = new WebviewDialogController(message => view.webview.postMessage(message));
    this.updateTitle();
    view.webview.html = this.html(context, view.webview);
    this.unsubscribe = repository.onDidChange(snapshot => {
      this.updateTitle();
      const identity = repositoryLogIdentity(snapshot.status);
      if (identity !== this.logIdentity) {
        this.logIdentity = identity;
        void this.loadLog(true);
      } else {
        this.postSnapshot();
      }
    });
    this.messageSubscription = view.webview.onDidReceiveMessage(message => void this.handleMessage(message));
    void this.initializeLog();
  }

  refresh(): void {
    this.postSnapshot();
  }

  showLog(): void {
    if (!this.fileHistoryPath) return;
    this.fileHistoryPath = null;
    this.activeRef = 'HEAD';
    this.filters = this.mainFilters;
    this.updateTitle();
    void this.initializeLog();
  }

  private async initializeLog(): Promise<void> {
    const request = this.logRequest;
    const head = this.repository.snapshot.status?.head;
    const cached = head && this.cacheable() ? await this.cache.read(this.repository.root, head) : null;
    if (request !== this.logRequest) return;
    if (!cached) {
      await this.loadLog(true);
      return;
    }
    this.commits = cached.commits.slice(0, 200);
    this.users = logUsers(this.commits, []);
    this.hasMore = cached.hasMore || cached.commits.length > this.commits.length;
    this.selectedHash = selectionAfterLogReload(this.commits, this.selectedHash);
    this.postSnapshot();
    const validation = this.loadLog(true, true);
    if (this.selectedHash) void this.loadDetails(this.selectedHash);
    await validation;
  }

  showFileHistory(path: string): void {
    if (this.fileHistoryPath === path) return;
    this.fileHistoryPath = path;
    this.activeRef = 'HEAD';
    this.filters = { ...emptyLogFilters, path };
    this.updateTitle();
    void this.loadLog(true);
  }

  revealCommit(hash: string): void {
    this.preferredSelection = hash;
    if (this.commits.some(commit => commit.hash === hash)) {
      this.preferredSelection = null;
      void this.loadDetails(hash);
    } else if (!this.logLoading) {
      void this.loadLog(true);
    }
  }

  async showCommit(hash: string): Promise<void> {
    const fromFileHistory = Boolean(this.fileHistoryPath);
    if (fromFileHistory) {
      this.fileHistoryPath = null;
      this.activeRef = 'HEAD';
      this.filters = { ...emptyLogFilters };
      this.updateTitle();
    }
    if (!fromFileHistory && this.commits.some(commit => commit.hash === hash)) {
      this.preferredSelection = null;
      await this.loadDetails(hash);
      return;
    }
    const navigation = ++this.commitNavigation;
    this.preferredSelection = hash;
    this.activeRef = 'HEAD';
    this.filters = { ...emptyLogFilters };
    await this.loadLog(true);
    while (navigation === this.commitNavigation && !this.findCommit(hash) && this.hasMore) await this.loadLog(false);
    if (navigation !== this.commitNavigation) return;
    if (this.findCommit(hash)) {
      this.preferredSelection = null;
      await this.loadDetails(hash);
      return;
    }
    this.preferredSelection = null;
    void vscode.window.showWarningMessage(`Commit ${hash.slice(0, 8)} was not found in the current branch history.`);
  }

  dispose(): void {
    this.logRequest += 1;
    this.detailsRequest += 1;
    clearTimeout(this.prefetchTimer);
    this.unsubscribe();
    this.messageSubscription.dispose();
    this.dialogs.cancel();
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    const request = message as Record<string, unknown>;
    try {
      switch (request.type) {
        case 'ready': this.postSnapshot(); break;
        case 'refresh':
          this.repository.invalidate('status', 'refs');
          await this.repository.refresh();
          await this.loadLog(true);
          break;
        case 'loadMore': await this.loadLog(false); break;
        case 'selectRef': await this.selectRef(request.ref); break;
        case 'filters': await this.setFilters(request.filters); break;
        case 'rememberSearch': await this.rememberSearch(request.text); break;
        case 'pickPaths': await this.pickPaths(request.kind); break;
        case 'dialog:pathChildren': await this.pathChildren(request.id, request.path); break;
        case 'selectCommit': await this.selectCommit(request.hash); break;
        case 'openCommitDiff': await this.openCommitDiff(request.hash, request.change); break;
        case 'commitFileAction': await this.commitFileAction(request.action, request.hash, request.paths); break;
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
    await this.persistState();
    await this.loadLog(true);
  }

  private async setFilters(value: unknown): Promise<void> {
    if (!isLogFilters(value) || JSON.stringify(value) === JSON.stringify(this.filters)) return;
    this.filters = value;
    if (this.fileHistoryPath && value.path !== this.fileHistoryPath) this.fileHistoryPath = null;
    if (!this.fileHistoryPath) {
      this.mainFilters = value;
      await this.persistState();
      this.updateTitle();
    }
    await this.loadLog(true);
  }

  private async rememberSearch(value: unknown): Promise<void> {
    if (typeof value !== 'string' || !value.trim()) return;
    const text = value.trim();
    this.searchHistory = [text, ...this.searchHistory.filter(item => item !== text)].slice(0, 10);
    await this.context.globalState.update(logSearchHistoryKey, this.searchHistory);
    this.postSnapshot();
  }

  private async pickPaths(value: unknown): Promise<void> {
    if (value !== 'paths') return;
    const picked = await this.dialogs.show({
      kind: 'path-tree',
      title: 'Select Paths to Filter by',
      entries: await this.readPathEntries(''),
      selectedPaths: this.filters.path.split(',').map(path => path.trim()).filter(Boolean)
    });
    if (picked?.length) await this.setFilters({ ...this.filters, path: [...new Set(picked)].join(', ') });
  }

  private async pathChildren(id: unknown, value: unknown): Promise<void> {
    if (!this.dialogs.isActive(id) || typeof value !== 'string') return;
    const entries = await this.readPathEntries(value);
    void this.view.webview.postMessage({ type: 'dialog:pathChildren', id, path: value, entries });
  }

  private async readPathEntries(path: string): Promise<PathTreeEntry[]> {
    const root = resolve(this.repository.root);
    const target = resolve(root, ...path.split('/'));
    const normalizedRoot = root.toLocaleLowerCase();
    const normalizedTarget = target.toLocaleLowerCase();
    if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}${sep}`)) return [];
    const entries = await readdir(target, { withFileTypes: true });
    return entries.filter(entry => entry.name !== '.git').map(entry => ({
      name: entry.name,
      path: path ? `${path}/${entry.name}` : entry.name,
      directory: entry.isDirectory()
    })).sort((left, right) => Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name));
  }

  private async loadLog(reset: boolean, quiet = false): Promise<void> {
    if (!reset && (this.logLoading || !this.hasMore)) return;
    const request = ++this.logRequest;
    const limit = reset ? Math.max(100, this.commits.length) : 200;
    this.logLoading = true;
    this.quietLogLoading = quiet;
    this.localError = null;
    if (!quiet) this.postSnapshot();
    try {
      const cacheHead = reset && this.cacheable() ? this.repository.snapshot.status?.head : null;
      const query = logQueryFromFilters(this.filters, this.activeRef);
      if (cacheHead) query.ref = cacheHead;
      if (this.fileHistoryPath) {
        query.followRenames = true;
        query.paths = [this.fileHistoryPath];
      }
      const page = await this.repository.git.log(this.repository.location, reset ? 0 : this.commits.length, limit, query);
      if (request !== this.logRequest) return;
      const next = reset ? page.commits : [...this.commits, ...page.commits.filter(commit => !this.commits.some(existing => existing.hash === commit.hash))];
      this.commits = next;
      this.users = logUsers(next, this.users);
      this.hasMore = page.hasMore;
      this.logLoading = false;
      this.quietLogLoading = false;
      if (cacheHead && this.repository.snapshot.status?.head === cacheHead) {
        void this.cache.write(this.repository.root, cacheHead, {
          commits: next.slice(0, 200),
          offset: 0,
          hasMore: page.hasMore || next.length > 200
        }).catch(() => undefined);
      }
      if (!reset) {
        this.postSnapshot();
        return;
      }
      const nextSelection = selectionAfterLogReload(next, this.selectedHash, this.preferredSelection);
      if (nextSelection === this.preferredSelection) this.preferredSelection = null;
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
      this.quietLogLoading = false;
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
    const cached = this.detailsCache.get(hash);
    if (cached) {
      this.details = cached;
      this.detailsLoading = false;
      this.postSnapshot();
      this.prefetchAround(hash);
      return;
    }
    this.detailsLoading = true;
    this.details = null;
    this.postSnapshot();
    try {
      const commit = this.findCommit(hash);
      const details = await this.requestDetails(hash, commit?.parents);
      if (request !== this.detailsRequest) return;
      this.details = details;
      this.detailsLoading = false;
      this.postSnapshot();
      this.prefetchAround(hash);
    } catch (error) {
      if (request !== this.detailsRequest) return;
      this.detailsLoading = false;
      throw error;
    }
  }

  private async openCommitDiff(hashValue: unknown, changeValue: unknown, preview = true): Promise<void> {
    if (typeof hashValue !== 'string' || hashValue !== this.details?.hash || !changeValue || typeof changeValue !== 'object') return;
    const requested = changeValue as CommitFileChange;
    const change = this.details.files.find(file => file.path === requested.path && file.status === requested.status);
    if (!change) return;
    const parent = this.details.parents[0] ?? null;
    const leftPath = change.originalPath ?? change.path;
    const left = revisionUri(this.repository, leftPath, change.status === 'added' ? null : parent);
    const right = revisionUri(this.repository, change.path, change.status === 'deleted' ? null : this.details.hash);
    await vscode.commands.executeCommand('vscode.diff', left, right, `${change.path} (${this.details.hash.slice(0, 8)})`, { preview });
  }

  private async commitFileAction(actionValue: unknown, hashValue: unknown, pathsValue: unknown): Promise<void> {
    if (typeof actionValue !== 'string' || typeof hashValue !== 'string' || hashValue !== this.details?.hash || !Array.isArray(pathsValue)) return;
    const paths = new Set(pathsValue.filter((path): path is string => typeof path === 'string'));
    const changes = this.details.files.filter(change => paths.has(change.path));
    if (!changes.length) return;
    const action = actionValue as CommitFileAction;
    const change = changes.length === 1 ? changes[0]! : null;

    if (action === 'showDiff' && change) return this.openCommitDiff(hashValue, change);
    if (action === 'showDiffNewTab' && change) return this.openCommitDiff(hashValue, change, false);
    if (action === 'compareLocal' && change) return this.compareFileWithLocal(change, false);
    if (action === 'compareBeforeLocal' && change) return this.compareFileWithLocal(change, true);
    if (action === 'editSource' && change) return this.editSource(change.path);
    if (action === 'openRepositoryVersion' && change && change.status !== 'deleted') {
      await vscode.commands.executeCommand('vscode.open', revisionUri(this.repository, change.path, this.details.hash), { preview: false });
      return;
    }
    if (action === 'revertSelected') return this.revertCommitChanges(hashValue, [...paths]);
    if (action === 'cherryPickSelected') return this.cherryPickCommitChanges(changes);
    if (action === 'createPatch') return this.createPatch(changes);
    if (action === 'getFromRevision') return this.getFromRevision(changes);
    if (action === 'historyUpToHere') {
      await this.setFilters({ ...this.filters, path: changes.map(file => file.path).join(', ') });
      return;
    }
    if (action === 'showChangesToParent' && change) return this.showChangesToParent(change);
    if (action === 'copyPath') await vscode.env.clipboard.writeText(changes.map(file => file.path).join('\n'));
  }

  private async compareFileWithLocal(change: CommitFileChange, before: boolean): Promise<void> {
    if (!this.details) return;
    const revision = before ? this.details.parents[0] ?? null : this.details.hash;
    const leftPath = before ? change.originalPath ?? change.path : change.path;
    const empty = before ? change.status === 'added' : change.status === 'deleted';
    const left = revisionUri(this.repository, leftPath, empty ? null : revision);
    const right = await this.localOrEmpty(change.path);
    const label = before ? 'Before ↔ Local' : 'Revision ↔ Local';
    await vscode.commands.executeCommand('vscode.diff', left, right, `${change.path} (${label})`, { preview: false });
  }

  private async editSource(path: string): Promise<void> {
    const uri = vscode.Uri.file(join(this.repository.root, path));
    try {
      await vscode.workspace.fs.stat(uri);
      await vscode.window.showTextDocument(uri, { preview: false });
    } catch {
      void vscode.window.showInformationMessage(`${path} does not exist in the local working tree.`);
    }
  }

  private async localOrEmpty(path: string): Promise<vscode.Uri> {
    const uri = vscode.Uri.file(join(this.repository.root, path));
    try {
      await vscode.workspace.fs.stat(uri);
      return uri;
    } catch {
      return revisionUri(this.repository, path, null);
    }
  }

  private async cherryPickCommitChanges(changes: readonly CommitFileChange[]): Promise<void> {
    if (!this.details) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Cherry-pick ${changes.length} selected change${changes.length === 1 ? '' : 's'} from ${this.details.hash.slice(0, 8)}?`,
      { modal: true, detail: 'The selected patch will be applied to the current working tree.' },
      'Cherry-Pick Changes'
    );
    if (!confirmed) return;
    await this.repository.cherryPickCommitChanges(this.details.parents[0] ?? null, this.details.hash, changes);
    await this.resolveConflictsIfNeeded();
  }

  private async createPatch(changes: readonly CommitFileChange[]): Promise<void> {
    if (!this.details) return;
    const target = await vscode.window.showSaveDialog({
      title: 'Create Patch from Selected Changes',
      defaultUri: vscode.Uri.file(join(this.repository.root, `${this.details.hash.slice(0, 8)}.patch`)),
      filters: { Patch: ['patch', 'diff'], 'All Files': ['*'] }
    });
    if (!target) return;
    const patch = await this.repository.git.commitPatch(this.repository.location, this.details.parents[0] ?? null, this.details.hash, changes);
    await writeFile(target.fsPath, patch, 'utf8');
    void vscode.window.showInformationMessage(`Patch saved to ${target.fsPath}.`);
  }

  private async getFromRevision(changes: readonly CommitFileChange[]): Promise<void> {
    if (!this.details) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Get ${changes.length} selected file${changes.length === 1 ? '' : 's'} from ${this.details.hash.slice(0, 8)}?`,
      { modal: true, detail: 'The selected revision will be applied to the working tree without creating a commit.' },
      'Get from Revision'
    );
    if (confirmed) await this.repository.getChangesFromRevision(this.details.hash, changes);
  }

  private async showChangesToParent(change: CommitFileChange): Promise<void> {
    if (!this.details || this.details.parents.length < 2) return;
    const parent = await this.dialogs.show({
      kind: 'list',
      title: `Show ${change.path} Changes to Parent`,
      searchable: this.details.parents.length > 3,
      items: this.details.parents.map((hash, index) => ({ id: hash, label: `Parent ${index + 1}`, description: hash.slice(0, 12) }))
    });
    if (typeof parent !== 'string') return;
    const parentChanges = await this.repository.git.changedFiles(this.repository.location, parent, this.details.hash);
    const parentChange = parentChanges.find(file => file.path === change.path || file.originalPath === change.path);
    if (!parentChange) {
      void vscode.window.showInformationMessage(`${change.path} has no changes relative to that parent.`);
      return;
    }
    const left = revisionUri(this.repository, parentChange.originalPath ?? parentChange.path, parentChange.status === 'added' ? null : parent);
    const right = revisionUri(this.repository, parentChange.path, parentChange.status === 'deleted' ? null : this.details.hash);
    await vscode.commands.executeCommand('vscode.diff', left, right, `${parentChange.path} (${parent.slice(0, 8)} ↔ ${this.details.hash.slice(0, 8)})`, { preview: false });
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
      if (confirmed) await checkoutWithSmartFallback(this.repository, commit.hash, true);
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
    const mode = await this.dialogs.show({ kind: 'list', title: `Reset current branch to ${hash.slice(0, 8)}`, searchable: false, items: [
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
    if (action === 'openWorktree') {
      if (ref.type === 'local-branch') await this.openExistingWorktree(ref.name);
      return;
    }
    const worktree = ref.type === 'local-branch' ? this.repository.worktreeForBranch(ref.name, true) : undefined;
    if (worktree && action === 'copyWorktreePath') {
      await vscode.env.clipboard.writeText(worktree.path);
      return;
    }
    if (worktree && action === 'manageWorktrees') {
      await vscode.commands.executeCommand('git4vsc.openWorktrees', this.repository);
      return;
    }
    if (worktree && ['lockWorktree', 'unlockWorktree', 'removeWorktree'].includes(action)) {
      const item = { repository: this.repository, worktree, current: false, open: workspaceFolderOpen(worktree.path) };
      await vscode.commands.executeCommand(`git4vsc.${action === 'removeWorktree' ? 'deleteWorktree' : action}`, item);
      this.worktreesChanged();
      return;
    }
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
      if (name && await createAndCheckoutWithSmartFallback(this.repository, name, ref.fullName, ref.type === 'remote-branch')) await this.resolveConflictsIfNeeded();
      return;
    }
    if (action === 'checkoutUpdate') {
      if (ref.type !== 'local-branch') return;
      if (await this.openExistingWorktree(ref.name)) return;
      const upstream = await this.repository.git.branchUpstream(this.repository.location, ref.name);
      if (!upstream) {
        void vscode.window.showWarningMessage(`${ref.name} has no tracked branch.`);
        return;
      }
      const before = ref.hash;
      if (!await runSmartCheckoutFallback(this.repository, ref.name, () => this.repository.checkoutAndUpdate(ref.name, upstream), () => this.repository.smartCheckoutAndUpdate(ref.name, upstream))) return;
      if (await this.resolveConflictsIfNeeded()) return;
      await notifyUpdateResult(this.repository, before, upstream);
      return;
    }
    if (action === 'checkoutRebase') {
      const current = this.repository.snapshot.status?.branch;
      if (!current) return;
      if (ref.type === 'local-branch' && await this.openExistingWorktree(ref.name)) return;
      const confirmed = await vscode.window.showWarningMessage(`Rebase ${ref.name} onto ${current} and check it out?`, { modal: true }, 'Checkout and Rebase');
      if (!confirmed) return;
      if (ref.type === 'local-branch') await runSmartCheckoutFallback(this.repository, ref.name, () => this.repository.checkoutAndRebase(ref.name, current), () => this.repository.smartCheckoutAndRebase(ref.name, current));
      else if (ref.type === 'remote-branch') {
        const local = await this.localBranchForRemote(ref);
        if (!local) return;
        if (local.exists && await this.openExistingWorktree(local.name)) return;
        if (local.exists) await runSmartCheckoutFallback(this.repository, local.name, () => this.repository.checkoutAndRebase(local.name, current), () => this.repository.smartCheckoutAndRebase(local.name, current));
        else await runSmartCheckoutFallback(this.repository, local.name, () => this.repository.checkoutRemoteAndRebase(local.name, ref.name, current), () => this.repository.smartCheckoutRemoteAndRebase(local.name, ref.name, current));
      }
      if (await this.resolveConflictsIfNeeded()) return;
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
      if (ref.type === 'remote-branch') {
        const local = await this.localBranchForRemote(ref);
        if (!local) return;
        if (local.exists && await this.openExistingWorktree(local.name)) return;
        if (local.exists) await checkoutWithSmartFallback(this.repository, local.name);
        else await createAndCheckoutWithSmartFallback(this.repository, local.name, ref.fullName, true);
      } else {
        if (ref.type === 'local-branch' && await this.openExistingWorktree(ref.name)) return;
        await checkoutWithSmartFallback(this.repository, ref.name, ref.type === 'tag');
      }
      await this.resolveConflictsIfNeeded();
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
    const before = ref.hash;
    const worktreeRepository = await checkedOutBranchRepository(this.repository, ref.name);
    if (ref.name === this.repository.snapshot.status?.branch || worktreeRepository) {
      const [remote, branch] = splitRemoteBranch(upstream);
      const configured = configuredUpdateStrategy();
      const strategy = configured === 'ask' ? await this.dialogs.show({ kind: 'list', title: 'Update Project', searchable: false, items: [
        { id: 'merge', label: 'Merge incoming changes into the current branch', description: 'Default' },
        { id: 'rebase', label: 'Rebase the current branch on top of incoming changes' }
      ], acceptLabel: 'Update' }) : configured;
      if (strategy !== 'merge' && strategy !== 'rebase') return;
      const target = worktreeRepository ?? this.repository;
      const completed = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Updating ${ref.name}…` }, () =>
        updateWithSmartFallback(target, remote, branch, strategy === 'rebase'));
      if (!completed) return;
      if (worktreeRepository) await refreshAfterLinkedWorktreeUpdate(this.repository);
      if (target.snapshot.status?.changes.some(change => change.conflict)) {
        await vscode.commands.executeCommand('git4vsc.resolveConflicts', target);
        return;
      }
      const after = target.snapshot.status?.head ?? null;
      await notifyUpdateResult(this.repository, before, upstream, after);
      return;
    }
    else await this.repository.updateBranch(ref.name, upstream);
    const after = this.repository.snapshot.status?.refs.find(candidate => candidate.type === 'local-branch' && candidate.name === ref.name)?.hash ?? null;
    await notifyUpdateResult(this.repository, before, upstream, after);
  }

  private async pushRef(ref: GitRef): Promise<void> {
    const upstream = ref.type === 'local-branch' ? await this.repository.git.branchUpstream(this.repository.location, ref.name) : null;
    const preferredRemote = upstream?.split('/', 1)[0];
    const remote = await this.pickRemote(ref.type === 'tag' ? `Push Tag ${ref.name}` : `Push Branch ${ref.name}`, preferredRemote);
    if (!remote) return;
    if (ref.type === 'tag') {
      await this.repository.pushTag(ref.name, remote);
      if (resultNotificationsEnabled()) void vscode.window.showInformationMessage(`Pushed tag ${ref.name} to ${remote}.`);
    }
    else if (ref.type === 'local-branch') await this.previewPush(this.repository, ref.name, remote, upstream ?? undefined);
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
      const before = this.repository.snapshot.status?.head ?? null;
      if (!await updateWithSmartFallback(this.repository, remote, branch, rebase)) return;
      if (await this.resolveConflictsIfNeeded()) return;
      await notifyUpdateResult(this.repository, before, ref.name);
    }
  }

  private async resolveConflictsIfNeeded(): Promise<boolean> {
    if (!this.repository.snapshot.status?.changes.some(change => change.conflict)) return false;
    await vscode.commands.executeCommand('git4vsc.resolveConflicts', this.repository);
    return true;
  }

  private async renameBranch(ref: GitRef): Promise<void> {
    if (ref.type !== 'local-branch') return;
    if (await this.openExistingWorktree(ref.name)) return;
    const name = await this.branchName(`Rename Branch ${ref.name}`, ref.name);
    if (name && name !== ref.name) await this.repository.renameBranch(ref.name, name);
  }

  private async deleteRef(ref: GitRef): Promise<void> {
    if (ref.type === 'local-branch') {
      if (await this.openExistingWorktree(ref.name)) return;
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
    if (ref?.type === 'local-branch' && await this.openExistingWorktree(ref.name)) return;
    if (ref?.type === 'local-branch' && ref.name !== this.repository.snapshot.status?.branch) {
      const path = await this.pickWorktreePath(ref.name, ref.name);
      if (!path) return;
      await this.repository.addWorktree(path, ref.fullName);
      this.worktreesChanged();
      await vscode.commands.executeCommand('git4vsc.openWorktrees', this.repository);
      const open = await vscode.window.showInformationMessage(`Worktree created at ${path}.`, 'Open Worktree');
      if (open) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), true);
      return;
    }
    const selection = await this.dialogs.show({ kind: 'list', title: `New Worktree for ${ref?.name ?? 'HEAD'}`, searchable: false, input: {
      label: 'Branch name',
      placeholder: 'Enter a new branch name',
      enabledFor: ['branch'],
      requiredFor: ['branch']
    }, items: [
      { id: 'branch', label: 'Create New Branch', description: 'Create and check out a new branch in the worktree' },
      { id: 'detached', label: 'Detached HEAD', description: 'Open the selected revision without owning a branch' }
    ], acceptLabel: 'Continue' });
    if (!selection) return;
    const mode = selection.id;
    if (mode !== 'branch' && mode !== 'detached') return;
    const newBranch = mode === 'branch' ? selection.input.trim() : undefined;
    if (newBranch && this.repository.snapshot.status?.refs.some(candidate => candidate.type === 'local-branch' && candidate.name === newBranch)) {
      void vscode.window.showWarningMessage(`Branch ${newBranch} already exists.`);
      return;
    }
    const path = await this.pickWorktreePath(ref?.name ?? 'HEAD', newBranch ?? ref?.name ?? 'HEAD');
    if (path) {
      await this.repository.addWorktree(path, ref?.fullName ?? 'HEAD', newBranch, mode === 'detached');
      this.worktreesChanged();
      await vscode.commands.executeCommand('git4vsc.openWorktrees', this.repository);
      const open = await vscode.window.showInformationMessage(`Worktree created at ${path}.`, 'Open Worktree');
      if (open) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), true);
    }
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
      notifyFetchResult(remote ?? undefined);
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

  private async pickWorktreePath(ref: string, directoryName: string): Promise<string | undefined> {
    const target = await vscode.window.showOpenDialog({ title: `New Worktree for ${ref}`, canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Use Empty Folder' });
    const selectedPath = target?.[0]?.fsPath;
    if (!selectedPath) return undefined;
    try {
      return await worktreePath(selectedPath, directoryName);
    } catch (error) {
      void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  private async openExistingWorktree(branch: string): Promise<boolean> {
    const worktree = this.repository.worktreeForBranch(branch, true);
    if (!worktree) return false;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktree.path), true);
    return true;
  }

  private prefetchAround(hash: string): void {
    clearTimeout(this.prefetchTimer);
    const index = this.commits.findIndex(commit => commit.hash === hash);
    if (index < 0) return;
    const commits = [this.commits[index + 1], this.commits[index - 1]].filter((commit): commit is CommitSummary => Boolean(commit));
    this.prefetchTimer = setTimeout(() => void this.prefetchDetails(hash, commits), 700);
  }

  private async prefetchDetails(selectedHash: string, commits: readonly CommitSummary[]): Promise<void> {
    for (const commit of commits) {
      if (this.selectedHash !== selectedHash) return;
      if (this.detailsCache.has(commit.hash) || this.detailsLoads.has(commit.hash)) continue;
      await this.requestDetails(commit.hash, commit.parents).catch(() => undefined);
    }
  }

  private requestDetails(hash: string, parents?: readonly string[]): Promise<CommitDetails> {
    const existing = this.detailsLoads.get(hash);
    if (existing) return existing;
    const request = this.repository.git.commitDetails(this.repository.location, hash, parents)
      .then(details => {
        this.cacheDetails(details);
        return details;
      })
      .finally(() => this.detailsLoads.delete(hash));
    this.detailsLoads.set(hash, request);
    return request;
  }

  private cacheDetails(details: CommitDetails): void {
    this.detailsCache.delete(details.hash);
    this.detailsCache.set(details.hash, details);
    if (this.detailsCache.size > 80) this.detailsCache.delete(this.detailsCache.keys().next().value!);
  }

  private stateKey(): string {
    return `git4vsc.logState:${this.repository.root}`;
  }

  private persistState(): Thenable<void> {
    return this.context.workspaceState.update(this.stateKey(), { filters: this.mainFilters } satisfies PersistedLogState);
  }

  private findCommit(hash: string): CommitSummary | undefined {
    return this.commits.find(commit => commit.hash === hash);
  }

  private findRef(fullName: string): GitRef | undefined {
    return this.repository.snapshot.status?.refs.find(ref => ref.fullName === fullName);
  }

  private cacheable(): boolean {
    return !this.fileHistoryPath && this.activeRef === 'HEAD'
      && !this.filters.text && !this.filters.regex && !this.filters.caseSensitive
      && !this.filters.user && this.filters.date === 'all' && !this.filters.path;
  }

  private postSnapshot(): void {
    const snapshot = this.repository.snapshot;
    const settings = readGeneralSettings();
    void this.view.webview.postMessage({
      type: 'snapshot',
      state: {
        status: snapshot.status,
        worktrees: snapshot.worktrees,
        commits: this.commits,
        activeRef: this.activeRef,
        favoriteRefs: [...this.favoriteRefs],
        filters: this.filters,
        fileHistoryPath: this.fileHistoryPath,
        searchHistory: this.searchHistory,
        users: this.users,
        selectedHash: this.selectedHash,
        details: this.details,
        hasMore: this.hasMore,
        loading: this.logLoading && !this.quietLogLoading,
        activity: settings.showOperationProgress ? (snapshot.operation ? operationActivity(snapshot.operation) : this.logLoading && !this.quietLogLoading ? 'Refreshing…' : null) : null,
        detailsLoading: this.detailsLoading,
        error: this.localError ?? snapshot.error
      }
    });
  }

  private updateTitle(): void {
    this.view.title = this.fileHistoryPath
      ? `File History — ${basename(this.fileHistoryPath)}`
      : `Git Log — ${this.repository.snapshot.status?.branch ?? 'HEAD'}`;
  }

  private html(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const cacheKey = context.extension.packageJSON.version;
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
  return typeof filters.text === 'string' && typeof filters.regex === 'boolean' && typeof filters.caseSensitive === 'boolean'
    && typeof filters.user === 'string' && typeof filters.path === 'string'
    && ['all', 'today', 'yesterday', 'week', 'month'].includes(String(filters.date));
}

function workspaceFolderOpen(path: string): boolean {
  const target = resolve(path);
  return vscode.workspace.workspaceFolders?.some(folder => {
    const root = resolve(folder.uri.fsPath);
    return process.platform === 'win32' ? root.toLowerCase() === target.toLowerCase() : root === target;
  }) ?? false;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function repositoryLogIdentity(status: RepositoryStatus | null): string {
  if (!status) return '';
  return `${status.branch ?? ''}:${status.head}:${status.refs.map(ref => `${ref.fullName}:${ref.hash}`).join('|')}`;
}

function normalizeLogFilters(value: unknown): LogFilters {
  if (!value || typeof value !== 'object') return { ...emptyLogFilters };
  const filters = value as Record<string, unknown>;
  const normalized = {
    text: typeof filters.text === 'string' ? filters.text : '',
    regex: filters.regex === true,
    caseSensitive: filters.caseSensitive === true,
    user: typeof filters.user === 'string' ? filters.user : '',
    date: filters.date,
    path: typeof filters.path === 'string' ? filters.path : ''
  };
  return isLogFilters(normalized) ? normalized : { ...emptyLogFilters };
}
