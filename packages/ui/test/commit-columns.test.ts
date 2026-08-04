import { describe, expect, it } from 'vitest';
import { defaultCommitColumnVisibility, defaultCommitColumnWidths, normalizeCommitColumnVisibility, normalizeCommitColumnWidths, resizeCommitDetailColumn, responsiveCommitColumnWidth } from '../src/commit-columns.js';

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

  it('keeps columns to the right fixed by resizing detail columns from their left edge', () => {
    const resized = resizeCommitDetailColumn(defaultCommitColumnWidths, 'date', 24);
    expect(resized).toEqual({ ...defaultCommitColumnWidths, commit: 464, date: 108 });
    expect(Object.values(resized).reduce((total, width) => total + width, 0)).toBe(Object.values(defaultCommitColumnWidths).reduce((total, width) => total + width, 0));
  });

  it('stops resizing when the detail or flexible commit column reaches its minimum', () => {
    expect(resizeCommitDetailColumn(defaultCommitColumnWidths, 'date', 200).date).toBe(95);
    expect(resizeCommitDetailColumn(defaultCommitColumnWidths, 'author', -200, 430)).toEqual({ ...defaultCommitColumnWidths, commit: 430, author: 120 });
  });

  it('lets the commit column consume the remaining viewport width', () => {
    expect(responsiveCommitColumnWidth(defaultCommitColumnWidths, defaultCommitColumnVisibility, 1000)).toBe(682);
    expect(responsiveCommitColumnWidth(defaultCommitColumnWidths, { author: false, date: true, hash: false }, 700)).toBe(556);
    expect(responsiveCommitColumnWidth(defaultCommitColumnWidths, defaultCommitColumnVisibility, 420)).toBe(180);
  });
});
