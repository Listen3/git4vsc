import type { CommitSummary, LogDateFilter, LogFilters, LogQuery } from '@git4vsc/shared-types';

export const emptyLogFilters: LogFilters = { text: '', regex: false, caseSensitive: false, user: '', date: 'all', path: '' };

export function logQueryFromFilters(filters: LogFilters, ref: string | null, now = Date.now()): LogQuery {
  const dates = dateRange(filters.date, now);
  const paths = filters.path.split(',').map(value => value.trim()).filter(Boolean);
  return {
    ...(ref ? { ref } : {}),
    ...(filters.text ? { text: filters.text, regex: filters.regex, caseSensitive: filters.caseSensitive } : {}),
    ...(filters.user ? { author: filters.user } : {}),
    ...dates,
    ...(paths.length ? { paths } : {})
  };
}

export function logUsers(commits: readonly CommitSummary[], existing: readonly string[] = []): string[] {
  return [...new Set([...existing, ...commits.map(commit => commit.authorName)].filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function dateRange(filter: LogDateFilter, now: number): Pick<LogQuery, 'since' | 'until'> {
  if (filter === 'all') return {};
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (filter === 'today') return { since: today.toISOString() };
  if (filter === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { since: yesterday.toISOString(), until: new Date(today.getTime() - 1).toISOString() };
  }
  const since = new Date(today);
  since.setDate(since.getDate() - (filter === 'week' ? 6 : 29));
  return { since: since.toISOString() };
}
