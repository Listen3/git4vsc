import { describe, expect, it } from 'vitest';
import type { CommitSummary } from '@git4vsc/shared-types';
import { selectionAfterLogReload } from '../src/log-selection.js';

function commit(hash: string): CommitSummary {
  return { hash, parents: [], authorName: '', authorEmail: '', authorTime: 0, committerTime: 0, subject: hash, refs: [] };
}

describe('log selection continuity', () => {
  it('prefers an explicitly revealed commit after a reload', () => {
    expect(selectionAfterLogReload([commit('new'), commit('selected')], 'selected', 'new')).toBe('new');
  });

  it('keeps the selected commit when it remains in the filtered log', () => {
    expect(selectionAfterLogReload([commit('new'), commit('selected'), commit('old')], 'selected')).toBe('selected');
  });

  it('selects the first commit when the previous selection disappears', () => {
    expect(selectionAfterLogReload([commit('new'), commit('old')], 'selected')).toBe('new');
  });

  it('clears the selection for an empty log', () => {
    expect(selectionAfterLogReload([], 'selected')).toBeNull();
  });
});
