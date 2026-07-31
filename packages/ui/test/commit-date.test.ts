import { describe, expect, it } from 'vitest';
import { formatCommitTime } from '../src/commit-date.js';

const now = Date.UTC(2026, 7, 1, 12, 0, 0);

describe('commit time formatting', () => {
  it('shows recent commits as relative time', () => {
    expect(formatCommitTime((now - 20_000) / 1000, now)).toBe(new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(0, 'second'));
    expect(formatCommitTime((now - 5 * 60_000) / 1000, now)).toBe(new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-5, 'minute'));
    expect(formatCommitTime((now - 3 * 60 * 60_000) / 1000, now)).toBe(new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-3, 'hour'));
  });

  it('shows an exact date after one day', () => {
    const timestamp = (now - 2 * 24 * 60 * 60_000) / 1000;
    expect(formatCommitTime(timestamp, now)).toContain('2026');
  });
});
