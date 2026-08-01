export function formatCommitTime(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp * 1000);
  const current = new Date(now);
  const days = calendarDay(current) - calendarDay(date);
  if (days === 0 || days === 1) {
    const label = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-days, 'day');
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${label.charAt(0).toLocaleUpperCase()}${label.slice(1)} ${time}`;
  }
  return formatExactCommitTime(timestamp);
}

function calendarDay(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
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
