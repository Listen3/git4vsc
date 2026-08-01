import { describe, expect, it } from 'vitest';
import type { CommitSummary } from '@git4vsc/shared-types';
import { filteredConnections } from '../src/CommitLog.js';

function commit(hash: string, parents: string[]): CommitSummary {
  return { hash, parents, authorName: 'A', authorEmail: 'a@example.test', authorTime: 0, committerTime: 0, subject: hash, refs: [] };
}

describe('filtered commit graph', () => {
  it('uses one solid rail for adjacent parents and dashed gaps for hidden commits', () => {
    const commits = [commit('C', ['B']), commit('B', ['A']), commit('X', ['R'])];
    expect(filteredConnections(commits, 0)).toEqual({ top: 'none', bottom: 'solid' });
    expect(filteredConnections(commits, 1)).toEqual({ top: 'solid', bottom: 'dashed' });
    expect(filteredConnections(commits, 2)).toEqual({ top: 'dashed', bottom: 'none' });
  });
});
