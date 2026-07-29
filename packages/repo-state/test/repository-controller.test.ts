import { describe, expect, it } from 'vitest';
import type { CommitPage, RepositoryStatus } from '@git4vsc/shared-types';
import type { GitClient, RepositoryLocation } from '@git4vsc/git-core';
import { RepositoryController } from '../src/repository-controller.js';

function status(root: string): RepositoryStatus {
  return { root, gitDir: `${root}/.git`, head: 'a', branch: 'main', upstream: null, ahead: 0, behind: 0, phase: 'normal', shallow: false, changes: [], refs: [] };
}

class FakeGit {
  active = 0;
  maxActive = 0;
  statusCalls = 0;
  logCalls = 0;

  async status(location: RepositoryLocation): Promise<RepositoryStatus> { this.statusCalls += 1; return status(location.root); }
  async log(_location: RepositoryLocation): Promise<CommitPage> { this.logCalls += 1; return { commits: [], offset: 0, hasMore: false }; }
  async stage(): Promise<void> { await this.write(); }
  async unstage(): Promise<void> { await this.write(); }
  async commit(): Promise<void> { await this.write(); }
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
    expect(fake.logCalls).toBe(3);
    expect(repository.snapshot.operation).toBeNull();
  });

  it('does not share operation locks between repositories', async () => {
    const fake = new FakeGit();
    const a = controller(fake, '/a');
    const b = controller(fake, '/b');
    await Promise.all([a.refresh(), b.refresh()]);
    await Promise.all([a.commit('a'), b.commit('b')]);
    expect(fake.maxActive).toBe(2);
  });
});

