import type { CommitSummary } from '@git4vsc/shared-types';

export function selectionAfterLogReload(commits: readonly CommitSummary[], selectedHash: string | null): string | null {
  return selectedHash && commits.some(commit => commit.hash === selectedHash) ? selectedHash : commits[0]?.hash ?? null;
}
