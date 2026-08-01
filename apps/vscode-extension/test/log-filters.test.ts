import { describe, expect, it } from 'vitest';
import type { CommitSummary } from '@git4vsc/shared-types';
import { emptyLogFilters, logQueryFromFilters, logUsers } from '../src/log-filters.js';

const now = new Date(2026, 7, 3, 12).getTime();

describe('log filters', () => {
  it('maps UI filters to Git log query arguments', () => {
    const query = logQueryFromFilters({ text: 'fix', user: 'Ada', date: 'yesterday', path: 'src, test/a.ts' }, 'refs/heads/main', now);
    expect(query).toMatchObject({ text: 'fix', author: 'Ada', ref: 'refs/heads/main', paths: ['src', 'test/a.ts'] });
    expect(query.since).toBeTruthy();
    expect(query.until).toBeTruthy();
  });

  it('keeps stable user choices', () => {
    expect(emptyLogFilters).toEqual({ text: '', user: '', date: 'all', path: '' });
    const commit = (authorName: string): CommitSummary => ({ hash: authorName, parents: [], authorName, authorEmail: '', authorTime: 0, committerTime: 0, subject: '', refs: [] });
    expect(logUsers([commit('Bob'), commit('Ada')], ['Bob'])).toEqual(['Ada', 'Bob']);
  });
});
