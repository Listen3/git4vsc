import { describe, expect, it } from 'vitest';
import { defaultCommitColumnVisibility, defaultCommitColumnWidths, normalizeCommitColumnVisibility, normalizeCommitColumnWidths } from '../src/commit-columns.js';

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

  it('normalizes persisted column visibility', () => {
    expect(normalizeCommitColumnVisibility()).toEqual(defaultCommitColumnVisibility);
    expect(normalizeCommitColumnVisibility({ author: false, hash: false })).toEqual({ author: false, date: true, hash: false });
  });
});
