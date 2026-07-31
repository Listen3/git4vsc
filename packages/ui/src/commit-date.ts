const minute = 60;
const hour = 60 * minute;
const day = 24 * hour;

export function formatCommitTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, Math.floor(now / 1000) - timestamp);
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (elapsed < minute) return relative.format(0, 'second');
  if (elapsed < hour) return relative.format(-Math.floor(elapsed / minute), 'minute');
  if (elapsed < day) return relative.format(-Math.floor(elapsed / hour), 'hour');
  return formatExactCommitTime(timestamp);
}

export function formatExactCommitTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
