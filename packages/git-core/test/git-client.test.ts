import { describe, expect, it, vi } from 'vitest';
import type { CommitSummary } from '@git4vsc/shared-types';
import type { CommandRunner } from '../src/command-runner.js';
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
