import { describe, expect, it } from 'vitest';
import type { CommitPage, GitWorktree, RepositoryStatus } from '@git4vsc/shared-types';
import type { GitClient, RepositoryLocation } from '@git4vsc/git-core';
import { RepositoryController } from '../src/repository-controller.js';

function status(root: string): RepositoryStatus {
  return { root, gitDir: `${root}/.git`, head: 'a', branch: 'main', upstream: null, ahead: 0, behind: 0, phase: 'normal', shallow: false, changes: [], refs: [] };
}

class FakeGit {
  active = 0;
  maxActive = 0;
  statusCalls = 0;
  statusMetadata: boolean[] = [];
  logCalls = 0;
  worktreeCalls = 0;
  conflictOnMerge = false;
  conflictOnPull = false;
  hasConflict = false;
  stashPops = 0;
  stashPopConflicts = false;
  rememberedStash: { ref: string; hash: string; branch: string; message: string; authorTime: number } | null = null;
  stashDrops = 0;
  smartStashClears = 0;

  async status(location: RepositoryLocation, includeMetadata = true): Promise<RepositoryStatus> {
    this.statusCalls += 1;
    this.statusMetadata.push(includeMetadata);
    const result = status(location.root);
    if (this.hasConflict) result.changes.push({ path: 'conflict.txt', index: 'unmerged', workingTree: 'unmerged', conflict: true });
    return result;
  }
  async log(_location: RepositoryLocation): Promise<CommitPage> { this.logCalls += 1; return { commits: [], offset: 0, hasMore: false }; }
  async worktrees(location: RepositoryLocation): Promise<GitWorktree[]> {
    this.worktreeCalls += 1;
    return [{ path: location.root, head: 'a', branch: 'main', main: true, detached: false, bare: false, locked: false, prunable: false }];
  }
  async stage(): Promise<void> { await this.write(); }
  async unstage(): Promise<void> { await this.write(); }
  async commit(): Promise<void> { await this.write(); }
  async merge(): Promise<void> {
    if (this.conflictOnMerge) this.hasConflict = true;
    throw new Error('merge conflict');
  }
  async stashPush(): Promise<{ ref: string; hash: string; branch: string; message: string; authorTime: number }> {
    return { ref: 'stash@{0}', hash: 'stash', branch: 'main', message: 'smart', authorTime: 0 };
  }
  async stashPop(): Promise<void> {
    this.stashPops += 1;
    if (this.stashPopConflicts) {
      this.hasConflict = true;
      throw new Error('stash conflict');
    }
  }
  async stashDrop(): Promise<void> { this.stashDrops += 1; }
  async rememberSmartStash(): Promise<void> {
    this.rememberedStash = { ref: 'stash@{0}', hash: 'stash', branch: 'main', message: 'smart', authorTime: 0 };
  }
  async pendingSmartStash(): Promise<typeof this.rememberedStash> { return this.rememberedStash; }
  async clearSmartStash(): Promise<void> { this.smartStashClears += 1; this.rememberedStash = null; }
  async checkout(): Promise<void> { await this.write(); }
  async pullBranch(): Promise<void> {
    if (this.conflictOnPull) {
      this.hasConflict = true;
      throw new Error('pull conflict');
    }
    await this.write();
  }
  async conflicts(): Promise<{ path: string }[]> { return this.hasConflict ? [{ path: 'conflict.txt' }] : []; }
  async continueOperation(): Promise<void> { this.hasConflict = false; }
  private async write(): Promise<void> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise(resolve => setTimeout(resolve, 30));
    this.active -= 1;
  }
}

function controller(fake: FakeGit, root: string): RepositoryController {
  return new RepositoryController(fake as unknown as GitClient, { root, gitDir: `${root}/.git` });
}

describe('RepositoryController', () => {
  it('serializes writes inside one repository and refreshes after commit', async () => {
    const fake = new FakeGit();
    const repository = controller(fake, '/a');
    await repository.refresh();
    await Promise.all([repository.commit('one'), repository.commit('two')]);
    expect(fake.maxActive).toBe(1);
    expect(fake.statusCalls).toBe(3);
    expect(fake.statusMetadata).toEqual([true, false, false]);
    expect(fake.logCalls).toBe(0);
    expect(repository.snapshot.operation).toBeNull();
    expect(repository.worktreeForBranch('main', true)).toBeUndefined();
  });

  it('does not share operation locks between repositories', async () => {
    const fake = new FakeGit();
    const a = controller(fake, '/a');
    const b = controller(fake, '/b');
    await Promise.all([a.refresh(), b.refresh()]);
    await Promise.all([a.commit('a'), b.commit('b')]);
    expect(fake.maxActive).toBe(2);
  });

  it('refreshes repository state when a write operation fails', async () => {
    const fake = new FakeGit();
    const repository = controller(fake, '/a');
    await repository.refresh();

    await expect(repository.merge('topic')).rejects.toThrow('merge conflict');

    expect(fake.statusCalls).toBe(2);
    expect(fake.logCalls).toBe(1);
    expect(repository.snapshot.operation).toBeNull();
    expect(repository.snapshot.error).toBe('merge conflict');
  });

  it('does not lose invalidations queued as an active refresh finishes', async () => {
    const fake = new FakeGit();
    const repository = controller(fake, '/a');
    await repository.refresh();

    let finishRefresh!: () => void;
    const inFlight = new Promise<void>(resolve => { finishRefresh = resolve; });
    const internal = repository as unknown as { activeRefresh: Promise<void> | null };
    internal.activeRefresh = inFlight.finally(() => { internal.activeRefresh = null; });

    repository.invalidate('status');
    const refresh = repository.refresh();
    finishRefresh();
    await refresh;

    expect(fake.statusCalls).toBe(2);
  });

  it('treats a merge conflict as repository state instead of a generic operation error', async () => {
    const fake = new FakeGit();
    fake.conflictOnMerge = true;
    const repository = controller(fake, '/a');
    await repository.refresh();

    await repository.merge('topic');

    expect(repository.snapshot.status?.changes[0]?.conflict).toBe(true);
    expect(repository.snapshot.error).toBeNull();
    expect(repository.snapshot.operation).toBeNull();
  });

  it('stashes and restores local changes around a smart checkout', async () => {
    const fake = new FakeGit();
    const repository = controller(fake, '/a');
    await repository.refresh();
    await repository.smartCheckout('topic');
    expect(fake.stashPops).toBe(1);
    expect(repository.snapshot.error).toBeNull();
  });

  it('restores the smart-operation stash after incoming conflicts are continued', async () => {
    const fake = new FakeGit();
    fake.conflictOnPull = true;
    const repository = controller(fake, '/a');
    await repository.refresh();
    await repository.smartPullBranch('origin', 'main', false);
    expect(fake.stashPops).toBe(0);
    expect(repository.snapshot.status?.changes[0]?.conflict).toBe(true);

    await repository.continueOperation();
    expect(fake.stashPops).toBe(1);
  });

  it('retains a smart stash until restoration conflicts are explicitly completed', async () => {
    const fake = new FakeGit();
    fake.conflictOnPull = true;
    fake.stashPopConflicts = true;
    const repository = controller(fake, '/a');
    await repository.refresh();
    await repository.smartPullBranch('origin', 'main', false);

    await repository.continueOperation();
    expect(repository.snapshot.status?.changes[0]?.conflict).toBe(true);
    expect(fake.rememberedStash?.hash).toBe('stash');
    expect(fake.smartStashClears).toBe(0);

    fake.hasConflict = false;
    await repository.completeNonOperationConflict();
    expect(fake.stashDrops).toBe(1);
    expect(fake.smartStashClears).toBe(1);
    expect(fake.rememberedStash).toBeNull();
  });
});
