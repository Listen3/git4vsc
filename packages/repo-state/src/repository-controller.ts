import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import type { GitClient, RepositoryLocation } from '@git4vsc/git-core';
import type { CommitFileChange, CommitSelection, GitChange, GitStashEntry, GitWorktree, RepositoryInvalidation, RepositorySnapshot } from '@git4vsc/shared-types';

class OperationQueue {
  private tail = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export class RepositoryController {
  private readonly events = new EventEmitter();
  private readonly invalid = new Set<RepositoryInvalidation>(['status', 'refs', 'worktrees']);
  private readonly operations = new OperationQueue();
  private activeRefresh: Promise<void> | null = null;
  private pendingSmartStash: GitStashEntry | null = null;
  private mutable: RepositorySnapshot = {
    status: null,
    commits: [],
    worktrees: [],
    loading: new Set(),
    operation: null,
    error: null,
    version: 0
  };

  constructor(readonly git: GitClient, readonly location: RepositoryLocation) {}

  get root(): string { return this.location.root; }

  get snapshot(): RepositorySnapshot { return this.mutable; }

  worktreeForBranch(branch: string, skipCurrent = false): GitWorktree | undefined {
    return this.mutable.worktrees.find(worktree => worktree.branch === branch && (!skipCurrent || !samePath(worktree.path, this.root)));
  }

  onDidChange(listener: (snapshot: RepositorySnapshot) => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }

  invalidate(...parts: RepositoryInvalidation[]): void {
    parts.forEach(part => this.invalid.add(part));
  }

  refresh(): Promise<void> {
    if (this.activeRefresh) {
      return this.activeRefresh.then(() => this.invalid.size > 0 ? this.refresh() : undefined);
    }
    this.activeRefresh = this.refreshInvalidated().finally(() => { this.activeRefresh = null; });
    return this.activeRefresh;
  }

  private async refreshInvalidated(): Promise<void> {
    while (this.invalid.size > 0) {
      const parts = new Set(this.invalid);
      this.invalid.clear();
      this.patch({ loading: parts, error: null });
      try {
        const includeMetadata = parts.has('refs') || this.mutable.status === null;
        const [status, log, worktreeResult] = await Promise.all([
          parts.has('status') || parts.has('refs') ? this.git.status(this.location, includeMetadata) : undefined,
          parts.has('log') ? this.git.log(this.location) : undefined,
          parts.has('worktrees')
            ? this.git.worktrees(this.location)
              .then(worktrees => ({ worktrees, error: null }))
              .catch(error => ({ worktrees: undefined, error: error instanceof Error ? error.message : String(error) }))
            : undefined
        ]);
        const nextStatus = status && !includeMetadata && this.mutable.status
          ? {
            ...status,
            refs: this.mutable.status.refs.map(ref => ref.type === 'local-branch' && ref.name === status.branch && status.head ? { ...ref, hash: status.head } : ref),
            shallow: this.mutable.status.shallow
          }
          : status;
        this.patch({
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(log ? { commits: log.commits } : {}),
          ...(worktreeResult?.worktrees ? { worktrees: worktreeResult.worktrees } : {}),
          loading: new Set(),
          ...(worktreeResult?.error ? { error: `Worktree information unavailable: ${worktreeResult.error}` } : {}),
          version: this.mutable.version + 1
        });
      } catch (error) {
        this.patch({ loading: new Set(), error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
  }

  async loadMore(limit = 200): Promise<void> {
    const page = await this.git.log(this.location, this.mutable.commits.length, limit);
    this.patch({ commits: [...this.mutable.commits, ...page.commits], version: this.mutable.version + 1 });
  }

  stage(paths: readonly string[]): Promise<void> {
    return this.runOperation('stage', () => this.git.stage(this.location, paths), ['status']);
  }

  unstage(paths: readonly string[]): Promise<void> {
    return this.runOperation('unstage', () => this.git.unstage(this.location, paths), ['status']);
  }

  addToIgnore(path: string): Promise<void> {
    return this.runOperation('add-to-ignore', () => this.git.addToIgnore(this.location, path), ['status']);
  }

  rollbackChanges(changes: readonly GitChange[]): Promise<void> {
    return this.runOperation('rollback', () => this.git.rollbackChanges(this.location, changes), ['status']);
  }

  revertCommitChanges(parent: string | null, hash: string, changes: readonly CommitFileChange[]): Promise<void> {
    return this.runOperation('revert-changes', () => this.git.revertCommitChanges(this.location, parent, hash, changes), ['status']);
  }

  cherryPickCommitChanges(parent: string | null, hash: string, changes: readonly CommitFileChange[]): Promise<void> {
    return this.runOperation('cherry-pick-changes', () => this.git.cherryPickCommitChanges(this.location, parent, hash, changes), ['status'], true);
  }

  getChangesFromRevision(hash: string, changes: readonly CommitFileChange[]): Promise<void> {
    return this.runOperation('get-from-revision', () => this.git.getChangesFromRevision(this.location, hash, changes), ['status']);
  }

  commit(message: string, all = false): Promise<void> {
    return this.runOperation('commit', () => this.git.commit(this.location, message, all), ['status']);
  }

  commitPaths(message: string, paths: readonly string[]): Promise<void> {
    return this.runOperation('commit', () => this.git.commitPaths(this.location, message, paths), ['status']);
  }

  commitSelections(message: string, selections: readonly CommitSelection[]): Promise<void> {
    return this.runOperation('commit', () => this.git.commitSelections(this.location, message, selections), ['status']);
  }

  stashChanges(message: string, includeUntracked = true): Promise<void> {
    return this.runOperation('stash', () => this.git.stashPush(this.location, message, includeUntracked).then(() => undefined), ['status']);
  }

  applyStash(ref: string, reinstateIndex = false): Promise<void> {
    return this.runOperation('apply-stash', () => this.git.stashApply(this.location, ref, reinstateIndex), ['status'], true);
  }

  popStash(ref: string, reinstateIndex = false): Promise<void> {
    return this.runOperation('pop-stash', () => this.git.stashPop(this.location, ref, reinstateIndex), ['status'], true);
  }

  dropStash(ref: string): Promise<void> {
    return this.runOperation('drop-stash', () => this.git.stashDrop(this.location, ref), ['status']);
  }

  createBranchFromStash(branch: string, ref: string): Promise<void> {
    return this.runOperation('stash-branch', () => this.git.stashBranch(this.location, branch, ref), ['status', 'log', 'refs'], true);
  }

  createBranch(name: string, startPoint: string): Promise<void> {
    return this.runOperation('create-branch', () => this.git.createBranch(this.location, name, startPoint), ['status', 'log', 'refs']);
  }

  createAndCheckoutBranch(name: string, startPoint: string, track = false): Promise<void> {
    return this.runOperation('checkout-new-branch', () => this.git.createAndCheckoutBranch(this.location, name, startPoint, track), ['status', 'log', 'refs', 'worktrees']);
  }

  checkoutAndUpdate(branch: string, upstream: string): Promise<void> {
    return this.runOperation('checkout-update', () => this.git.checkoutAndUpdate(this.location, branch, upstream), ['status', 'log', 'refs', 'worktrees'], true);
  }

  smartCheckoutAndUpdate(branch: string, upstream: string): Promise<void> {
    return this.runPreservingOperation('smart-checkout-update', () => this.git.checkoutAndUpdate(this.location, branch, upstream));
  }

  checkoutAndRebase(branch: string, currentBranch: string): Promise<void> {
    return this.runOperation('checkout-rebase', () => this.git.checkoutAndRebase(this.location, branch, currentBranch), ['status', 'log', 'refs', 'worktrees'], true);
  }

  smartCheckoutAndRebase(branch: string, currentBranch: string): Promise<void> {
    return this.runPreservingOperation('smart-checkout-rebase', () => this.git.checkoutAndRebase(this.location, branch, currentBranch));
  }

  checkoutRemoteAndRebase(localBranch: string, remoteBranch: string, currentBranch: string): Promise<void> {
    return this.runOperation('checkout-rebase', () => this.git.checkoutRemoteAndRebase(this.location, localBranch, remoteBranch, currentBranch), ['status', 'log', 'refs', 'worktrees'], true);
  }

  smartCheckoutRemoteAndRebase(localBranch: string, remoteBranch: string, currentBranch: string): Promise<void> {
    return this.runPreservingOperation('smart-checkout-rebase', () => this.git.checkoutRemoteAndRebase(this.location, localBranch, remoteBranch, currentBranch));
  }

  createTag(name: string, startPoint: string): Promise<void> {
    return this.runOperation('create-tag', () => this.git.createTag(this.location, name, startPoint), ['log', 'refs']);
  }

  checkout(target: string, detach = false, track = false): Promise<void> {
    return this.runOperation('checkout', () => this.git.checkout(this.location, target, detach, track), ['status', 'log', 'refs', 'worktrees']);
  }

  forceCheckout(target: string, detach = false, track = false): Promise<void> {
    return this.runOperation('force-checkout', () => this.git.forceCheckout(this.location, target, detach, track), ['status', 'log', 'refs', 'worktrees']);
  }

  smartCheckout(target: string, detach = false, track = false): Promise<void> {
    return this.runPreservingOperation('smart-checkout', () => this.git.checkout(this.location, target, detach, track));
  }

  smartCreateAndCheckoutBranch(name: string, startPoint: string, track = false): Promise<void> {
    return this.runPreservingOperation('smart-checkout', () => this.git.createAndCheckoutBranch(this.location, name, startPoint, track));
  }

  merge(ref: string): Promise<void> {
    return this.runOperation('merge', () => this.git.merge(this.location, ref), ['status', 'log', 'refs'], true);
  }

  acceptConflictSide(paths: readonly string[], side: 'ours' | 'theirs'): Promise<void> {
    return this.runOperation(`accept-${side}`, () => this.git.acceptConflictSide(this.location, paths, side), ['status']);
  }

  markConflictResolved(paths: readonly string[]): Promise<void> {
    return this.runOperation('mark-resolved', () => this.git.markConflictResolved(this.location, paths), ['status']);
  }

  restoreConflict(paths: readonly string[]): Promise<void> {
    return this.runOperation('restore-conflict', () => this.git.restoreConflict(this.location, paths), ['status']);
  }

  continueOperation(): Promise<void> {
    const phase = this.mutable.status?.phase ?? 'normal';
    return this.runOperation('continue', async () => {
      await this.git.continueOperation(this.location, phase);
      if (!(await this.git.conflicts(this.location)).length) await this.restorePendingSmartStash();
    }, ['status', 'log', 'refs', 'worktrees'], true);
  }

  abortOperation(): Promise<void> {
    const phase = this.mutable.status?.phase ?? 'normal';
    return this.runOperation('abort', async () => {
      await this.git.abortOperation(this.location, phase);
      await this.restorePendingSmartStash();
    }, ['status', 'log', 'refs'], true);
  }

  completeNonOperationConflict(): Promise<void> {
    return this.runOperation('complete-conflict', async () => {
      const stash = this.pendingSmartStash ?? await this.git.pendingSmartStash(this.location);
      if (!stash) return;
      await this.git.stashDrop(this.location, stash.ref);
      await this.git.clearSmartStash(this.location);
      this.pendingSmartStash = null;
    }, ['status', 'log', 'refs']);
  }

  rebase(ref: string): Promise<void> {
    return this.runOperation('rebase', () => this.git.rebase(this.location, ref), ['status', 'log', 'refs'], true);
  }

  renameBranch(oldName: string, newName: string): Promise<void> {
    return this.runOperation('rename-branch', () => this.git.renameBranch(this.location, oldName, newName), ['status', 'log', 'refs', 'worktrees']);
  }

  deleteBranch(name: string, force = false): Promise<void> {
    return this.runOperation('delete-branch', () => this.git.deleteBranch(this.location, name, force), ['status', 'log', 'refs', 'worktrees']);
  }

  deleteRemoteBranch(remote: string, branch: string): Promise<void> {
    return this.runOperation('delete-remote-branch', () => this.git.deleteRemoteBranch(this.location, remote, branch), ['status', 'log', 'refs']);
  }

  deleteTag(name: string): Promise<void> {
    return this.runOperation('delete-tag', () => this.git.deleteTag(this.location, name), ['log', 'refs']);
  }

  setUpstream(branch: string, upstream: string): Promise<void> {
    return this.runOperation('set-upstream', () => this.git.setUpstream(this.location, branch, upstream), ['status', 'refs']);
  }

  updateBranch(branch: string, upstream: string): Promise<void> {
    return this.runOperation('update-branch', () => this.git.updateBranch(this.location, branch, upstream), ['status', 'log', 'refs']);
  }

  pushBranch(branch: string, remote: string, targetBranch = branch, force = false): Promise<void> {
    return this.runOperation('push-branch', () => this.git.pushBranch(this.location, branch, remote, targetBranch, force), ['status']);
  }

  pullBranch(remote: string, branch: string, rebase: boolean): Promise<void> {
    return this.runOperation(rebase ? 'pull-rebase' : 'pull-merge', () => this.git.pullBranch(this.location, remote, branch, rebase), ['status', 'log', 'refs'], true);
  }

  smartPullBranch(remote: string, branch: string, rebase: boolean): Promise<void> {
    return this.runPreservingOperation(rebase ? 'smart-pull-rebase' : 'smart-pull-merge', () => this.git.pullBranch(this.location, remote, branch, rebase));
  }

  pushTag(name: string, remote: string): Promise<void> {
    return this.runOperation('push-tag', () => this.git.pushTag(this.location, name, remote), ['log', 'refs']);
  }

  fetchRemote(remote?: string): Promise<void> {
    return this.runOperation('fetch', () => this.git.fetchRemote(this.location, remote), ['status', 'log', 'refs']);
  }

  addRemote(name: string, url: string): Promise<void> {
    return this.runOperation('add-remote', () => this.git.addRemote(this.location, name, url), ['status', 'refs']);
  }

  setRemoteUrl(name: string, url: string): Promise<void> {
    return this.runOperation('edit-remote', () => this.git.setRemoteUrl(this.location, name, url), ['status', 'refs']);
  }

  removeRemote(name: string): Promise<void> {
    return this.runOperation('remove-remote', () => this.git.removeRemote(this.location, name), ['status', 'log', 'refs']);
  }

  addWorktree(path: string, ref: string, newBranch?: string, detach = false): Promise<void> {
    return this.runOperation('add-worktree', () => this.git.addWorktree(this.location, path, ref, newBranch, detach), ['refs', 'worktrees']);
  }

  removeWorktree(path: string, force = false): Promise<void> {
    return this.runOperation('remove-worktree', () => this.git.removeWorktree(this.location, path, force), ['refs', 'worktrees']);
  }

  pruneWorktrees(): Promise<void> {
    return this.runOperation('prune-worktrees', () => this.git.pruneWorktrees(this.location), ['refs', 'worktrees']);
  }

  lockWorktree(path: string, reason?: string): Promise<void> {
    return this.runOperation('lock-worktree', () => this.git.lockWorktree(this.location, path, reason), ['refs', 'worktrees']);
  }

  unlockWorktree(path: string): Promise<void> {
    return this.runOperation('unlock-worktree', () => this.git.unlockWorktree(this.location, path), ['refs', 'worktrees']);
  }

  cherryPick(hash: string): Promise<void> {
    return this.runOperation('cherry-pick', () => this.git.cherryPick(this.location, hash), ['status', 'log', 'refs'], true);
  }

  revert(hash: string): Promise<void> {
    return this.runOperation('revert', () => this.git.revert(this.location, hash), ['status', 'log', 'refs'], true);
  }

  reset(hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    return this.runOperation('reset', () => this.git.reset(this.location, hash, mode), ['status', 'log', 'refs']);
  }

  private runOperation(
    name: string,
    operation: () => Promise<void>,
    invalidations: RepositoryInvalidation[],
    conflictsAreResult = false
  ): Promise<void> {
    return this.operations.run(async () => {
      this.patch({ operation: name, error: null });
      try {
        let operationError: unknown = null;
        try {
          await operation();
        } catch (error) {
          operationError = error;
        }
        this.invalidate(...invalidations);
        await this.refresh();
        if (operationError !== null) {
          if (conflictsAreResult && this.mutable.status?.changes.some(change => change.conflict)) return;
          this.patch({ error: operationError instanceof Error ? operationError.message : String(operationError) });
          throw operationError;
        }
      } finally {
        this.patch({ operation: null });
      }
    });
  }

  private runPreservingOperation(name: string, operation: () => Promise<void>): Promise<void> {
    return this.runOperation(name, async () => {
      const stash = await this.git.stashPush(this.location, `Git4VSC smart operation: ${name}`, true);
      try {
        await operation();
      } catch (error) {
        if (stash) {
          if ((await this.git.conflicts(this.location)).length) {
            this.pendingSmartStash = stash;
            await this.git.rememberSmartStash(this.location, stash.hash);
          }
          else await this.restoreSmartStash(stash);
        }
        throw error;
      }
      if (stash) await this.restoreSmartStash(stash);
    }, ['status', 'log', 'refs'], true);
  }

  private async restorePendingSmartStash(): Promise<void> {
    const stash = this.pendingSmartStash ?? await this.git.pendingSmartStash(this.location);
    if (!stash) return;
    await this.restoreSmartStash(stash);
  }

  private async restoreSmartStash(stash: GitStashEntry): Promise<void> {
    try {
      await this.git.stashPop(this.location, stash.ref, true);
    } catch (error) {
      if ((await this.git.conflicts(this.location)).length) {
        this.pendingSmartStash = stash;
        await this.git.rememberSmartStash(this.location, stash.hash);
      }
      throw error;
    }
    this.pendingSmartStash = null;
    await this.git.clearSmartStash(this.location);
  }

  private patch(patch: Partial<RepositorySnapshot>): void {
    this.mutable = { ...this.mutable, ...patch };
    this.events.emit('change', this.mutable);
  }
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
