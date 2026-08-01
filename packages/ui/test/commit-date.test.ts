import { describe, expect, it } from 'vitest';
import { formatCommitTime } from '../src/commit-date.js';

const now = new Date(2026, 7, 3, 12, 0, 0).getTime();

function dayLabel(days: number): string {
  const value = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-days, 'day');
  return `${value.charAt(0).toLocaleUpperCase()}${value.slice(1)}`;
}

describe('commit time formatting', () => {
  it('uses calendar-day labels for today and yesterday', () => {
    expect(formatCommitTime(new Date(2026, 7, 3, 1, 54).getTime() / 1000, now)).toContain(dayLabel(0));
    expect(formatCommitTime(new Date(2026, 7, 2, 23, 59).getTime() / 1000, now)).toContain(dayLabel(1));
  });

  it('shows an exact date before yesterday', () => {
    const timestamp = new Date(2026, 7, 1, 23, 59).getTime() / 1000;
    expect(formatCommitTime(timestamp, now)).toContain('2026');
  });
});
