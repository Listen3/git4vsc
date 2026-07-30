import { describe, expect, it } from 'vitest';
import { defaultCommitColumnWidths, normalizeCommitColumnWidths } from '../src/commit-columns.js';

describe('commit column widths', () => {
  it('uses stable defaults', () => {
    expect(normalizeCommitColumnWidths()).toEqual(defaultCommitColumnWidths);
  });

  it('rounds and clamps persisted or dragged widths', () => {
    expect(normalizeCommitColumnWidths({ commit: 120.4, author: 500, date: 140.6, hash: 20 })).toEqual({
      commit: 180,
      author: 320,
      date: 141,
      hash: 56
    });
  });
});
