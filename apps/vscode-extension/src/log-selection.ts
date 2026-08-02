import type { CommitSummary } from '@git4vsc/shared-types';

export function selectionAfterLogReload(commits: readonly CommitSummary[], selectedHash: string | null, preferredHash: string | null = null): string | null {
  if (preferredHash && commits.some(commit => commit.hash === preferredHash)) return preferredHash;
  return selectedHash && commits.some(commit => commit.hash === selectedHash) ? selectedHash : commits[0]?.hash ?? null;
}
