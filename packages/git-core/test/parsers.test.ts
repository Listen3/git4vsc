import { describe, expect, it } from 'vitest';
import { parseBlame, parseLog, parseNameStatus, parsePorcelainV2, parseRefs, parseUnmergedIndex } from '../src/parsers.js';

describe('parseBlame', () => {
  it('parses line porcelain metadata', () => {
    const output = [
      '0123456789abcdef0123456789abcdef01234567 4 7 1',
      'author Ada Lovelace',
      'author-mail <ada@example.com>',
      'author-time 1234567890',
      'summary explain the line',
      'filename src/main.ts',
      '\tconst answer = 42;',
      ''
    ].join('\n');
    expect(parseBlame(output)).toEqual([{
      hash: '0123456789abcdef0123456789abcdef01234567',
      line: 7,
      authorName: 'Ada Lovelace',
      authorEmail: 'ada@example.com',
      authorTime: 1234567890,
      summary: 'explain the line'
    }]);
  });
});

describe('parsePorcelainV2', () => {
  it('parses branch metadata and every change class', () => {
    const output = [
      '# branch.oid abcdef',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -3',
      '1 M. N... 100644 100644 100644 aaa bbb staged.txt',
      '1 .M N... 100644 100644 100644 aaa bbb working tree.txt',
      '2 R. N... 100644 100644 100644 aaa bbb R100 renamed.txt',
      'old name.txt',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt',
      '? new.txt',
      ''
    ].join('\0');

    expect(parsePorcelainV2(output)).toEqual({
      head: 'abcdef', branch: 'main', upstream: 'origin/main', ahead: 2, behind: 3,
      changes: [
        { path: 'staged.txt', index: 'modified', workingTree: null, conflict: false },
        { path: 'working tree.txt', index: null, workingTree: 'modified', conflict: false },
        { path: 'renamed.txt', originalPath: 'old name.txt', index: 'renamed', workingTree: null, conflict: false },
        { path: 'conflict.txt', index: 'unmerged', workingTree: 'unmerged', conflict: true },
        { path: 'new.txt', index: null, workingTree: 'untracked', conflict: false }
      ]
    });
  });
});

describe('refs and log', () => {
  it('keeps full ref identity', () => {
    expect(parseRefs('refs/heads/main\taaa\torigin/main\t<\nrefs/heads/feature\tbbb\torigin/feature\t<>\nrefs/remotes/origin/main\taaa\nrefs/tags/v1\taaa\n')).toEqual([
      { name: 'main', fullName: 'refs/heads/main', hash: 'aaa', type: 'local-branch', upstream: 'origin/main', tracking: 'behind' },
      { name: 'feature', fullName: 'refs/heads/feature', hash: 'bbb', type: 'local-branch', upstream: 'origin/feature', tracking: 'diverged' },
      { name: 'origin/main', fullName: 'refs/remotes/origin/main', hash: 'aaa', type: 'remote-branch', remote: 'origin' },
      { name: 'v1', fullName: 'refs/tags/v1', hash: 'aaa', type: 'tag' }
    ]);
  });

  it('parses NUL-delimited topological metadata', () => {
    const output = ['abc', 'p1 p2', 'Ada', 'ada@example.com', '10', '11', 'merge subject', 'HEAD -> refs/heads/main, refs/remotes/origin/HEAD, refs/tags/v1'].join('\0') + '\0';
    expect(parseLog(output)).toEqual([{
      hash: 'abc', parents: ['p1', 'p2'], authorName: 'Ada', authorEmail: 'ada@example.com',
      authorTime: 10, committerTime: 11, subject: 'merge subject',
      refs: [
        { name: 'main', fullName: 'refs/heads/main', hash: 'abc', type: 'local-branch' },
        { name: 'v1', fullName: 'refs/tags/v1', hash: 'abc', type: 'tag' }
      ]
    }]);
  });
});

describe('parseUnmergedIndex', () => {
  it('preserves stage availability and conflict kinds', () => {
    const output = [
      '100644 aaaa 1\tboth.txt', '100644 bbbb 2\tboth.txt', '100644 cccc 3\tboth.txt',
      '100644 dddd 1\tdeleted-by-us.txt', '100644 eeee 3\tdeleted-by-us.txt',
      '100644 ffff 2\tboth-added.txt', '100644 aaaa 3\tboth-added.txt', ''
    ].join('\0');
    expect(parseUnmergedIndex(output)).toEqual([
      { path: 'both.txt', kind: 'both-modified', base: true, ours: true, theirs: true },
      { path: 'deleted-by-us.txt', kind: 'deleted-by-us', base: true, ours: false, theirs: true },
      { path: 'both-added.txt', kind: 'both-added', base: false, ours: true, theirs: true }
    ]);
  });
});

describe('parseNameStatus', () => {
  it('parses ordinary, renamed and copied commit files', () => {
    expect(parseNameStatus('M\0src/main.ts\0R100\0old.ts\0new.ts\0C090\0base.txt\0copy.txt\0D\0gone.txt\0')).toEqual([
      { path: 'src/main.ts', status: 'modified' },
      { path: 'new.ts', originalPath: 'old.ts', status: 'renamed' },
      { path: 'copy.txt', originalPath: 'base.txt', status: 'copied' },
      { path: 'gone.txt', status: 'deleted' }
    ]);
  });
});
