import { describe, expect, it } from 'vitest';
import type { GitClient, RepositoryLocation } from '@git4vsc/git-core';
import type { CommitPage, GitWorktree, RepositoryStatus } from '@git4vsc/shared-types';
import { RepositoryManager } from '../src/repository-manager.js';

class FakeGit {
  statusCalls = 0;
  worktreeError: Error | null = null;

  async discover(): Promise<RepositoryLocation> {
    return { root: '/repository', gitDir: '/repository/.git' };
  }

  async status(location: RepositoryLocation): Promise<RepositoryStatus> {
    this.statusCalls += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return { ...location, head: 'head', branch: 'main', upstream: null, ahead: 0, behind: 0, phase: 'normal', shallow: false, changes: [], refs: [] };
  }

  async log(): Promise<CommitPage> {
    return { commits: [], offset: 0, hasMore: false };
  }

  async worktrees(): Promise<GitWorktree[]> {
    if (this.worktreeError) throw this.worktreeError;
    return [];
  }
}

describe('RepositoryManager', () => {
  it('shares initialization when the same repository is opened concurrently', async () => {
    const git = new FakeGit();
    const manager = new RepositoryManager(git as unknown as GitClient);
    const [first, second] = await Promise.all([manager.open('/repository'), manager.open('/repository/subdirectory')]);

    expect(first).toBe(second);
    expect(manager.all).toEqual([first]);
    expect(git.statusCalls).toBe(1);
  });

  it('opens the repository when optional worktree discovery fails', async () => {
    const git = new FakeGit();
    git.worktreeError = new Error("unknown switch `z'");
    const manager = new RepositoryManager(git as unknown as GitClient);

    const repository = await manager.open('/repository');

    expect(manager.all).toEqual([repository]);
    expect(repository.snapshot.status?.root).toBe('/repository');
    expect(repository.snapshot.worktrees).toEqual([]);
    expect(repository.snapshot.error).toBe("Worktree information unavailable: unknown switch `z'");
  });
});
