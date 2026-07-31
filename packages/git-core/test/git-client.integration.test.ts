import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readFile, rename } from 'node:fs/promises';
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
    await client.createAndCheckoutBranch(location, 'client-checkout', 'refs/remotes/origin/main', true);
    expect((await client.status(location)).branch).toBe('client-checkout');
    expect(await client.branchUpstream(location, 'client-checkout')).toBe('origin/main');
    await client.checkout(location, 'main');
    await client.deleteBranch(location, 'client-checkout');
    await client.checkoutRemoteAndRebase(location, 'client-remote-rebase', 'origin/main', 'main');
    expect((await client.status(location)).branch).toBe('client-remote-rebase');
    expect(await client.branchUpstream(location, 'client-remote-rebase')).toBe('origin/main');
    await client.checkout(location, 'main');
    await client.deleteBranch(location, 'client-remote-rebase');
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

  it('commits only the files selected in the Commit view', async () => {
    const location = await client.discover(fixtures.history);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${location.root}/selected.txt`, 'selected');
    await writeFile(`${location.root}/left-staged.txt`, 'left staged');
    await client.stage(location, ['left-staged.txt']);
    await client.commitPaths(location, 'selected files commit', ['selected.txt']);

    const status = await client.status(location);
    expect(status.changes).toContainEqual({ path: 'left-staged.txt', index: 'added', workingTree: null, conflict: false });
    expect(status.changes.some(change => change.path === 'selected.txt')).toBe(false);
    expect((await client.log(location, 0, 1)).commits[0]?.subject).toBe('selected files commit');
  });

  it('commits both sides of a selected rename', async () => {
    const location = await client.discover(fixtures.history);
    await rename(`${location.root}/line.txt`, `${location.root}/line-renamed.txt`);
    await client.commitPaths(location, 'selected rename commit', ['line.txt', 'line-renamed.txt']);

    const details = await client.commitDetails(location, (await client.log(location, 0, 1)).commits[0]!.hash);
    expect(details.files).toContainEqual({ path: 'line-renamed.txt', originalPath: 'line.txt', status: 'renamed' });
    expect((await client.status(location)).changes).toContainEqual({ path: 'left-staged.txt', index: 'added', workingTree: null, conflict: false });
  });

  it('rolls back tracked changes without deleting added or unversioned files', async () => {
    const location = await client.discover(fixtures.history);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${location.root}/base.txt`, 'changed');
    await writeFile(`${location.root}/rollback-added.txt`, 'added');
    await writeFile(`${location.root}/rollback-unversioned.txt`, 'unversioned');
    await client.stage(location, ['rollback-added.txt']);
    await client.rollbackChanges(location, [
      { path: 'base.txt', index: null, workingTree: 'modified', conflict: false },
      { path: 'rollback-added.txt', index: 'added', workingTree: null, conflict: false },
      { path: 'rollback-unversioned.txt', index: null, workingTree: 'untracked', conflict: false }
    ]);

    expect(await readFile(`${location.root}/base.txt`, 'utf8')).toBe('base');
    const changes = (await client.status(location)).changes;
    expect(changes).toContainEqual({ path: 'rollback-added.txt', index: null, workingTree: 'untracked', conflict: false });
    expect(changes).toContainEqual({ path: 'rollback-unversioned.txt', index: null, workingTree: 'untracked', conflict: false });
  });

  it('adds an unversioned file to the repository ignore file once', async () => {
    const location = await client.discover(fixtures.history);
    await client.addToIgnore(location, 'cache/output.tmp');
    await client.addToIgnore(location, 'cache/output.tmp');

    const ignore = await readFile(`${location.root}/.gitignore`, 'utf8');
    expect(ignore.match(/cache\/output\.tmp/g)).toHaveLength(1);
  });

  it('loads three-way conflicts, accepts each side and continues the merge', async () => {
    const location = await client.discover(fixtures.conflict);
    expect((await client.status(location)).phase).toBe('merging');
    expect(await client.conflicts(location)).toEqual([
      { path: 'delete-them.txt', kind: 'deleted-by-them', base: true, ours: true, theirs: false },
      { path: 'delete-us.txt', kind: 'deleted-by-us', base: true, ours: false, theirs: true },
      { path: 'first.txt', kind: 'both-modified', base: true, ours: true, theirs: true },
      { path: 'second.txt', kind: 'both-modified', base: true, ours: true, theirs: true }
    ]);
    expect(await client.show(location, 'first.txt', ':1')).toBe('base first');
    expect(await client.show(location, 'first.txt', ':2')).toBe('current first');
    expect(await client.show(location, 'first.txt', ':3')).toBe('incoming first');

    await client.acceptConflictSide(location, ['first.txt'], 'ours');
    await client.acceptConflictSide(location, ['second.txt', 'delete-us.txt', 'delete-them.txt'], 'theirs');
    expect(await client.conflicts(location)).toEqual([]);
    expect(await readFile(join(location.root, 'first.txt'), 'utf8')).toBe('current first');
    expect(await readFile(join(location.root, 'second.txt'), 'utf8')).toBe('incoming second');
    expect(await readFile(join(location.root, 'delete-us.txt'), 'utf8')).toBe('incoming kept');
    await expect(readFile(join(location.root, 'delete-them.txt'), 'utf8')).rejects.toThrow();

    await client.continueOperation(location, 'merging');
    expect((await client.status(location)).phase).toBe('normal');
    expect((await client.log(location, 0, 1)).commits[0]?.parents).toHaveLength(2);
  });
});
