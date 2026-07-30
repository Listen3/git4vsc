import { describe, expect, it } from 'vitest';
import { parseLog, parseNameStatus, parsePorcelainV2, parseRefs } from '../src/parsers.js';

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
    expect(parseRefs('refs/heads/main\taaa\nrefs/remotes/origin/main\taaa\nrefs/tags/v1\taaa\n')).toEqual([
      { name: 'main', fullName: 'refs/heads/main', hash: 'aaa', type: 'local-branch' },
      { name: 'origin/main', fullName: 'refs/remotes/origin/main', hash: 'aaa', type: 'remote-branch', remote: 'origin' },
      { name: 'v1', fullName: 'refs/tags/v1', hash: 'aaa', type: 'tag' }
    ]);
  });

  it('parses NUL-delimited topological metadata', () => {
    const output = ['abc', 'p1 p2', 'Ada', 'ada@example.com', '10', '11', 'merge subject', 'HEAD -> refs/heads/main, refs/tags/v1'].join('\0') + '\0';
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
