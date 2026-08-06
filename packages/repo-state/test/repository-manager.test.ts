import { describe, expect, it } from 'vitest';
import type { GitClient, RepositoryLocation } from '@git4vsc/git-core';
import type { CommitPage, RepositoryStatus } from '@git4vsc/shared-types';
import { RepositoryManager } from '../src/repository-manager.js';

class FakeGit {
  statusCalls = 0;

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
});
