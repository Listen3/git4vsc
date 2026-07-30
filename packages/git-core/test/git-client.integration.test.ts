import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { GitClient } from '../src/git-client.js';
import { createFixtureSet, type FixtureSet } from './git-fixtures.js';

describe('GitClient against generated repositories', () => {
  let fixtures: FixtureSet;
  const client = new GitClient();

  beforeAll(() => { fixtures = createFixtureSet(); }, 30_000);
  afterAll(() => fixtures.cleanup(), 30_000);

  it('reads refs, status and topological merge parents', async () => {
    const location = await client.discover(fixtures.history);
    const [status, page] = await Promise.all([client.status(location), client.log(location, 0, 100)]);
    expect(status.branch).toBe('main');
    expect(status.refs.some(ref => ref.type === 'tag' && ref.name === 'v1')).toBe(true);
    expect(status.refs.some(ref => ref.type === 'remote-branch')).toBe(true);
    expect(page.commits.some(commit => commit.parents.length === 2)).toBe(true);
    expect(page.commits.some(commit => commit.parents.length === 3)).toBe(true);
    const positions = new Map(page.commits.map((commit, index) => [commit.hash, index]));
    for (const commit of page.commits) {
      for (const parent of commit.parents) {
        if (positions.has(parent)) expect(positions.get(commit.hash)!).toBeLessThan(positions.get(parent)!);
      }
    }
  });

  it('recognizes shallow clones, worktrees and submodules', async () => {
    const shallow = await client.discover(fixtures.shallow);
    const worktree = await client.discover(fixtures.worktree);
    const submoduleHost = await client.discover(fixtures.submoduleHost);
    expect((await client.status(shallow)).shallow).toBe(true);
    expect(worktree.gitDir.toLowerCase()).toContain('worktrees');
    expect((await client.status(worktree)).phase).toBe('detached');
    expect((await client.status(submoduleHost)).changes).toEqual([]);
  });

  it('filters the log and loads full commit details with changed files', async () => {
    const location = await client.discover(fixtures.history);
    const feature = (await client.log(location, 0, 100, { text: 'feature commit' })).commits[0];
    expect(feature?.subject).toBe('feature commit');
    const byHash = await client.log(location, 0, 10, { text: feature!.hash.slice(0, 8) });
    expect(byHash.commits.map(commit => commit.hash)).toEqual([feature!.hash]);
    const details = await client.commitDetails(location, feature!.hash);
    expect(details.message).toContain('feature commit');
    expect(details.files).toContainEqual({ path: 'feature.txt', status: 'added' });
    expect(details.containingBranches.length).toBeGreaterThan(0);
  });

  it('compares changed files between revisions', async () => {
    const location = await client.discover(fixtures.history);
    const feature = (await client.log(location, 0, 100, { text: 'feature commit' })).commits[0]!;
    const files = await client.changedFiles(location, `${feature.hash}^`, feature.hash);
    expect(files).toContainEqual({ path: 'feature.txt', status: 'added' });
  });

  it('manages local branch and tag refs', async () => {
    const location = await client.discover(fixtures.history);
    await client.addRemote(location, 'origin', location.root);
    await client.createBranch(location, 'client-action', 'HEAD');
    await client.renameBranch(location, 'client-action', 'client-renamed');
    await client.setUpstream(location, 'client-renamed', 'origin/main');
    expect(await client.branchUpstream(location, 'client-renamed')).toBe('origin/main');
    expect((await client.status(location)).refs.some(ref => ref.name === 'client-renamed')).toBe(true);
    await client.createAndCheckoutBranch(location, 'client-checkout', 'HEAD');
    expect((await client.status(location)).branch).toBe('client-checkout');
    await client.checkout(location, 'main');
    await client.deleteBranch(location, 'client-checkout');
    await client.deleteBranch(location, 'client-renamed');
    await client.createTag(location, 'client-tag', 'HEAD');
    await client.deleteTag(location, 'client-tag');
    const worktree = join(fixtures.base, 'client-created-worktree');
    await client.addWorktree(location, worktree, 'HEAD');
    expect((await client.status(await client.discover(worktree))).phase).toBe('detached');
    await client.removeRemote(location, 'origin');
    expect((await client.status(location)).refs.some(ref => ref.name.startsWith('client-'))).toBe(false);
  });

  it('manages remote configuration', async () => {
    const location = await client.discover(fixtures.history);
    await client.addRemote(location, 'client-remote', fixtures.submoduleHost);
    expect(await client.remotes(location)).toContain('client-remote');
    expect(await client.remoteUrl(location, 'client-remote')).toBe(fixtures.submoduleHost);
    await client.setRemoteUrl(location, 'client-remote', fixtures.shallow);
    expect(await client.remoteUrl(location, 'client-remote')).toBe(fixtures.shallow);
    await client.removeRemote(location, 'client-remote');
    expect(await client.remotes(location)).not.toContain('client-remote');
  });

  it('commits and refreshes real status/log data', async () => {
    const location = await client.discover(fixtures.history);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${location.root}/vertical.txt`, 'vertical');
    expect((await client.status(location)).changes.some(change => change.path === 'vertical.txt')).toBe(true);
    await client.commit(location, 'vertical chain commit', true);
    expect((await client.status(location)).changes).toEqual([]);
    expect((await client.log(location, 0, 1)).commits[0]?.subject).toBe('vertical chain commit');
  });
});
