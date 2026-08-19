import { describe, expect, it } from 'vitest';
import type { GitBlameLine } from '@git4vsc/shared-types';
import { updateBlameLines } from '../src/blame-lines.js';

function blame(line: number, hash = `hash-${line}`): GitBlameLine {
  return { hash, line, authorName: `author-${line}`, authorEmail: '', authorTime: line, summary: '' };
}

describe('blame line updates', () => {
  it('keeps following blame entries aligned after inserting a line', () => {
    const result = updateBlameLines([blame(1), blame(2), blame(3)], [{ startLine: 1, endLine: 1, text: '\n' }], 4);

    expect(result.map(line => line.hash)).toEqual(['hash-1', '0'.repeat(40), '0'.repeat(40), 'hash-3']);
    expect(result.map(line => line.line)).toEqual([1, 2, 3, 4]);
  });

  it('marks a line uncommitted when its leading whitespace changes', () => {
    const result = updateBlameLines([blame(1), blame(2)], [{ startLine: 0, endLine: 0, text: '' }], 2);

    expect(result[0]?.hash).toBe('0'.repeat(40));
    expect(result[1]?.hash).toBe('hash-2');
  });

  it('keeps following blame entries aligned after joining lines', () => {
    const result = updateBlameLines(
      [blame(1), blame(2), blame(3), blame(4)],
      [{ startLine: 1, endLine: 2, text: '' }],
      3
    );

    expect(result.map(line => line.hash)).toEqual(['hash-1', '0'.repeat(40), 'hash-4']);
  });
});
