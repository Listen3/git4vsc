import { EventEmitter } from 'node:events';
import type { GitClient, RepositoryLocation } from '@git4vsc/git-core';
import type { RepositoryInvalidation, RepositorySnapshot } from '@git4vsc/shared-types';

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

  commit(message: string, all = false): Promise<void> {
    return this.runOperation('commit', () => this.git.commit(this.location, message, all), ['status', 'log', 'refs']);
  }

  createBranch(name: string, startPoint: string): Promise<void> {
    return this.runOperation('create-branch', () => this.git.createBranch(this.location, name, startPoint), ['status', 'log', 'refs']);
  }

  createTag(name: string, startPoint: string): Promise<void> {
    return this.runOperation('create-tag', () => this.git.createTag(this.location, name, startPoint), ['log', 'refs']);
  }

  checkout(target: string, detach = false, track = false): Promise<void> {
    return this.runOperation('checkout', () => this.git.checkout(this.location, target, detach, track), ['status', 'log', 'refs']);
  }

  merge(ref: string): Promise<void> {
    return this.runOperation('merge', () => this.git.merge(this.location, ref), ['status', 'log', 'refs']);
  }

  cherryPick(hash: string): Promise<void> {
    return this.runOperation('cherry-pick', () => this.git.cherryPick(this.location, hash), ['status', 'log', 'refs']);
  }

  revert(hash: string): Promise<void> {
    return this.runOperation('revert', () => this.git.revert(this.location, hash), ['status', 'log', 'refs']);
  }

  reset(hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    return this.runOperation('reset', () => this.git.reset(this.location, hash, mode), ['status', 'log', 'refs']);
  }

  private runOperation(
    name: string,
    operation: () => Promise<void>,
    invalidations: RepositoryInvalidation[]
  ): Promise<void> {
    return this.operations.run(async () => {
      this.patch({ operation: name, error: null });
      try {
        await operation();
        this.invalidate(...invalidations);
        await this.refresh();
      } catch (error) {
        this.patch({ error: error instanceof Error ? error.message : String(error) });
        throw error;
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
