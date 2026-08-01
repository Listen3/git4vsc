import { EventEmitter } from 'node:events';
import type { GitClient, RepositoryLocation } from '@git4vsc/git-core';
import type { CommitFileChange, GitChange, RepositoryInvalidation, RepositorySnapshot } from '@git4vsc/shared-types';

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
  private readonly invalid = new Set<RepositoryInvalidation>(['status', 'log', 'refs']);
  private readonly operations = new OperationQueue();
  private activeRefresh: Promise<void> | null = null;
  private mutable: RepositorySnapshot = {
    status: null,
    commits: [],
    loading: new Set(),
    operation: null,
    error: null,
    version: 0
  };

  constructor(readonly git: GitClient, readonly location: RepositoryLocation) {}

  get root(): string { return this.location.root; }

  get snapshot(): RepositorySnapshot { return this.mutable; }

  onDidChange(listener: (snapshot: RepositorySnapshot) => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }

  invalidate(...parts: RepositoryInvalidation[]): void {
    parts.forEach(part => this.invalid.add(part));
  }

  refresh(): Promise<void> {
    if (this.activeRefresh) return this.activeRefresh;
    this.activeRefresh = this.refreshInvalidated().finally(() => { this.activeRefresh = null; });
    return this.activeRefresh;
  }

  private async refreshInvalidated(): Promise<void> {
    while (this.invalid.size > 0) {
      const parts = new Set(this.invalid);
      this.invalid.clear();
      this.patch({ loading: parts, error: null });
      try {
        const [status, log] = await Promise.all([
          parts.has('status') || parts.has('refs') ? this.git.status(this.location) : undefined,
          parts.has('log') ? this.git.log(this.location) : undefined
        ]);
        this.patch({
          ...(status ? { status } : {}),
          ...(log ? { commits: log.commits } : {}),
          loading: new Set(),
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

  commit(message: string, all = false): Promise<void> {
    return this.runOperation('commit', () => this.git.commit(this.location, message, all), ['status', 'log', 'refs']);
  }

  commitPaths(message: string, paths: readonly string[]): Promise<void> {
    return this.runOperation('commit', () => this.git.commitPaths(this.location, message, paths), ['status', 'log', 'refs']);
  }

  createBranch(name: string, startPoint: string): Promise<void> {
    return this.runOperation('create-branch', () => this.git.createBranch(this.location, name, startPoint), ['status', 'log', 'refs']);
  }

  createAndCheckoutBranch(name: string, startPoint: string, track = false): Promise<void> {
    return this.runOperation('checkout-new-branch', () => this.git.createAndCheckoutBranch(this.location, name, startPoint, track), ['status', 'log', 'refs']);
  }

  checkoutAndUpdate(branch: string, upstream: string): Promise<void> {
    return this.runOperation('checkout-update', () => this.git.checkoutAndUpdate(this.location, branch, upstream), ['status', 'log', 'refs'], true);
  }

  checkoutAndRebase(branch: string, currentBranch: string): Promise<void> {
    return this.runOperation('checkout-rebase', () => this.git.checkoutAndRebase(this.location, branch, currentBranch), ['status', 'log', 'refs'], true);
  }

  checkoutRemoteAndRebase(localBranch: string, remoteBranch: string, currentBranch: string): Promise<void> {
    return this.runOperation('checkout-rebase', () => this.git.checkoutRemoteAndRebase(this.location, localBranch, remoteBranch, currentBranch), ['status', 'log', 'refs'], true);
  }

  createTag(name: string, startPoint: string): Promise<void> {
    return this.runOperation('create-tag', () => this.git.createTag(this.location, name, startPoint), ['log', 'refs']);
  }

  checkout(target: string, detach = false, track = false): Promise<void> {
    return this.runOperation('checkout', () => this.git.checkout(this.location, target, detach, track), ['status', 'log', 'refs']);
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
    return this.runOperation('continue', () => this.git.continueOperation(this.location, phase), ['status', 'log', 'refs']);
  }

  abortOperation(): Promise<void> {
    const phase = this.mutable.status?.phase ?? 'normal';
    return this.runOperation('abort', () => this.git.abortOperation(this.location, phase), ['status', 'log', 'refs']);
  }

  rebase(ref: string): Promise<void> {
    return this.runOperation('rebase', () => this.git.rebase(this.location, ref), ['status', 'log', 'refs'], true);
  }

  renameBranch(oldName: string, newName: string): Promise<void> {
    return this.runOperation('rename-branch', () => this.git.renameBranch(this.location, oldName, newName), ['status', 'log', 'refs']);
  }

  deleteBranch(name: string, force = false): Promise<void> {
    return this.runOperation('delete-branch', () => this.git.deleteBranch(this.location, name, force), ['status', 'log', 'refs']);
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

  pushBranch(branch: string, remote: string): Promise<void> {
    return this.runOperation('push-branch', () => this.git.pushBranch(this.location, branch, remote), ['status', 'log', 'refs']);
  }

  pullBranch(remote: string, branch: string, rebase: boolean): Promise<void> {
    return this.runOperation(rebase ? 'pull-rebase' : 'pull-merge', () => this.git.pullBranch(this.location, remote, branch, rebase), ['status', 'log', 'refs'], true);
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

  addWorktree(path: string, ref: string, newBranch?: string): Promise<void> {
    return this.runOperation('add-worktree', () => this.git.addWorktree(this.location, path, ref, newBranch), ['refs']);
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

  private patch(patch: Partial<RepositorySnapshot>): void {
    this.mutable = { ...this.mutable, ...patch };
    this.events.emit('change', this.mutable);
  }
}
