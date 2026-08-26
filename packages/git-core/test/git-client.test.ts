import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommitSummary } from '@git4vsc/shared-types';
import { GitCommandError, type CommandRunner } from '../src/command-runner.js';
import { GitClient } from '../src/git-client.js';

const location = { root: '/repository', gitDir: '/repository/.git' };

function result(stdout: string) {
  return { command: 'git', args: [], exitCode: 0, stdout, stderr: '' };
}

function commit(hash: string, parents: string[] = []): CommitSummary {
  return { hash, parents, authorName: 'Author', authorEmail: 'author@example.test', authorTime: 1, committerTime: 1, subject: hash, refs: [] };
}

describe('GitClient push preview queries', () => {
  it('does not truncate outgoing commits', async () => {
    const output = Array.from({ length: 101 }, (_, index) => [String(index).padStart(40, '0'), '', 'Author', 'author@example.test', '1', '1', `commit ${index}`, ''].join('\0')).join('\0');
    const run = vi.fn().mockResolvedValue(result(output));
    const client = new GitClient({ run } as unknown as CommandRunner);

    expect((await client.outgoingCommits(location, 'main', 'origin', 'origin/main')).length).toBe(101);
    expect(run.mock.calls[0]![0]).not.toContain(expect.stringMatching(/^--max-count=/));
  });

  it('batches first-parent file comparisons using Git 2.23-compatible arguments', async () => {
    const commits = [commit('a'.repeat(40), ['1'.repeat(40), '2'.repeat(40)]), commit('b'.repeat(40), ['3'.repeat(40)]), commit('c'.repeat(40))];
    const output = `${commits[0]!.hash}\0A\0merged.txt\0${commits[1]!.hash}\0M\0changed.txt\0${commits[2]!.hash}\0A\0root.txt\0`;
    const run = vi.fn().mockResolvedValue(result(output));
    const client = new GitClient({ run } as unknown as CommandRunner);

    const files = await client.commitFiles(location, commits);

    expect(run.mock.calls[0]![0]).not.toContain(expect.stringMatching(/^--diff-merges=/));
    expect(run.mock.calls[0]![1].input).toBe(`${commits[0]!.hash} ${commits[0]!.parents[0]}\n${commits[1]!.hash} ${commits[1]!.parents[0]}\n${commits[2]!.hash}\n`);
    expect(files.get(commits[0]!.hash)).toEqual([{ path: 'merged.txt', status: 'added' }]);
  });
});

describe('GitClient repository discovery compatibility', () => {
  it('resolves the common Git directory when Git does not support --path-format', async () => {
    const unsupported = new GitCommandError({
      command: 'git',
      args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      exitCode: 129,
      stdout: '',
      stderr: "error: unknown option `path-format=absolute'"
    });
    const run = vi.fn(async (args: readonly string[]) => {
      if (args.includes('--show-toplevel')) return result('/repository\n');
      if (args.includes('--absolute-git-dir')) return result('/repository/.git\n');
      if (args.includes('--path-format=absolute')) throw unsupported;
      return result('../.git\n');
    });
    const client = new GitClient({ run } as unknown as CommandRunner);

    await expect(client.discover('/repository/nested')).resolves.toEqual({
      root: '/repository',
      gitDir: '/repository/.git',
      commonDir: '/repository/.git'
    });
    expect(run).toHaveBeenCalledWith(['-C', '/repository/nested', 'rev-parse', '--git-common-dir']);
  });

  it('does not hide unrelated common directory failures', async () => {
    const failure = new GitCommandError({ command: 'git', args: [], exitCode: 1, stdout: '', stderr: 'fatal: corrupt repository' });
    const run = vi.fn(async (args: readonly string[]) => {
      if (args.includes('--path-format=absolute')) throw failure;
      return result('/repository\n');
    });
    const client = new GitClient({ run } as unknown as CommandRunner);

    await expect(client.discover('/repository')).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe('GitClient stash compatibility', () => {
  it('loads tracked and untracked stash changes when stash show lacks --include-untracked', async () => {
    const unsupported = new GitCommandError({
      command: 'git',
      args: ['stash', 'show', '--include-untracked'],
      exitCode: 129,
      stdout: '',
      stderr: "error: unknown option `include-untracked'"
    });
    const run = vi.fn()
      .mockRejectedValueOnce(unsupported)
      .mockResolvedValueOnce(result('M\0tracked.txt\0'))
      .mockResolvedValueOnce(result(`${'a'.repeat(40)}\n`))
      .mockResolvedValueOnce(result('A\0untracked.txt\0'));
    const client = new GitClient({ run } as unknown as CommandRunner);

    await expect(client.stashChanges(location, 'stash@{0}')).resolves.toEqual([
      { path: 'tracked.txt', status: 'modified' },
      { path: 'untracked.txt', status: 'added' }
    ]);
    expect(run.mock.calls.map(call => call[0])).toEqual([
      ['-C', '/repository', 'stash', 'show', '--include-untracked', '--name-status', '-z', '-M', '-C', 'stash@{0}'],
      ['-C', '/repository', 'stash', 'show', '--name-status', '-z', '-M', '-C', 'stash@{0}'],
      ['-C', '/repository', 'rev-parse', '--verify', 'stash@{0}^3'],
      ['-C', '/repository', 'diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', '-M', '-C', 'a'.repeat(40), '--']
    ]);
  });

  it('does not hide unrelated stash failures', async () => {
    const failure = new GitCommandError({ command: 'git', args: [], exitCode: 1, stdout: '', stderr: 'fatal: bad revision' });
    const run = vi.fn().mockRejectedValue(failure);
    const client = new GitClient({ run } as unknown as CommandRunner);

    await expect(client.stashChanges(location, 'missing')).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('GitClient worktree compatibility', () => {
  it('falls back to line-delimited porcelain when Git does not support -z', async () => {
    const unsupported = new GitCommandError({
      command: 'git',
      args: ['worktree', 'list', '--porcelain', '-z'],
      exitCode: 129,
      stdout: '',
      stderr: "error: unknown switch `z'"
    });
    const output = ['worktree /repository', 'HEAD aaaa', 'branch refs/heads/main', '', ''].join('\n');
    const run = vi.fn()
      .mockRejectedValueOnce(unsupported)
      .mockResolvedValueOnce(result(output));
    const client = new GitClient({ run } as unknown as CommandRunner);

    await expect(client.worktrees(location)).resolves.toEqual([
      { path: '/repository', head: 'aaaa', branch: 'main', main: true, detached: false, bare: false, locked: false, prunable: false }
    ]);
    expect(run.mock.calls.map(call => call[0])).toEqual([
      ['-C', '/repository', 'worktree', 'list', '--porcelain', '-z'],
      ['-C', '/repository', 'worktree', 'list', '--porcelain']
    ]);
  });

  it('does not hide unrelated worktree failures', async () => {
    const failure = new GitCommandError({ command: 'git', args: [], exitCode: 1, stdout: '', stderr: 'fatal: broken repository metadata' });
    const run = vi.fn().mockRejectedValue(failure);
    const client = new GitClient({ run } as unknown as CommandRunner);

    await expect(client.worktrees(location)).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('recovers locked and prunable metadata omitted by old porcelain output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'git4vsc-worktree-compat-'));
    const root = join(directory, 'repository');
    const gitDir = join(root, '.git');
    const feature = join(directory, 'feature');
    const missing = join(directory, 'missing');
    const metadata = join(gitDir, 'worktrees');
    try {
      await mkdir(join(metadata, 'feature'), { recursive: true });
      await mkdir(join(metadata, 'missing'), { recursive: true });
      await mkdir(feature, { recursive: true });
      await writeFile(join(feature, '.git'), 'gitdir metadata');
      await writeFile(join(metadata, 'feature', 'gitdir'), `${join(feature, '.git')}\n`);
      await writeFile(join(metadata, 'feature', 'locked'), 'in use\n');
      await writeFile(join(metadata, 'missing', 'gitdir'), `${join(missing, '.git')}\n`);

      const unsupported = new GitCommandError({
        command: 'git', args: [], exitCode: 129, stdout: '', stderr: "error: unknown switch `z'"
      });
      const output = [
        `worktree ${root}`, 'HEAD aaaa', 'branch refs/heads/main', '',
        `worktree ${feature}`, 'HEAD bbbb', 'branch refs/heads/feature', '',
        `worktree ${missing}`, 'HEAD cccc', 'detached', '', ''
      ].join('\n');
      const run = vi.fn().mockRejectedValueOnce(unsupported).mockResolvedValueOnce(result(output));
      const client = new GitClient({ run } as unknown as CommandRunner);

      const worktrees = await client.worktrees({ root, gitDir, commonDir: gitDir });

      expect(worktrees.find(worktree => worktree.path === feature)).toMatchObject({ locked: true, lockReason: 'in use', prunable: false });
      expect(worktrees.find(worktree => worktree.path === missing)).toMatchObject({ locked: false, prunable: true, pruneReason: 'gitdir file points to non-existent location' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
