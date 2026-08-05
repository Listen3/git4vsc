import type { RepositorySnapshot, RepositoryStatus } from '@git4vsc/shared-types';

export interface StatusBarPresentation {
  title: string;
  tooltip: string;
}

export interface RepositoryViewBadge {
  value: number;
  tooltip: string;
}

export function statusBarPresentation(snapshot: RepositorySnapshot): StatusBarPresentation {
  const status = snapshot.status;
  const branch = status?.branch ?? status?.head?.slice(0, 8) ?? 'HEAD';
  const conflicts = status?.changes.filter(change => change.conflict).length ?? 0;
  const operation = snapshot.operation ? operationLabel(snapshot.operation) : null;
  const sync = branchTrackingSuffix(status);

  let title = sync ? `${branch} ${sync}` : branch;
  if (operation) title = `$(sync~spin) ${operation}`;
  else if (conflicts) title = `$(warning) ${branch} · ${conflicts}`;
  else if (status && status.phase !== 'normal' && status.phase !== 'detached') title = `$(git-merge) ${branch} · ${phaseLabel(status.phase)}`;
  else if (snapshot.error) title = `$(error) ${branch}`;

  const lines = [
    operation ? `Git4VSC: ${operation}` : `Git4VSC: ${branch}`,
    status?.upstream ? `Tracks ${status.upstream} · ahead ${status.ahead} · behind ${status.behind}` : 'No tracked branch',
    conflicts ? `${conflicts} unresolved conflict${conflicts === 1 ? '' : 's'}` : `${status?.changes.length ?? 0} working tree change${status?.changes.length === 1 ? '' : 's'}`,
    status && status.phase !== 'normal' ? `Repository state: ${phaseLabel(status.phase)}` : '',
    snapshot.error ? `Error: ${snapshot.error}` : '',
    'Click to open branches and actions'
  ].filter(Boolean);
  return { title, tooltip: lines.join('\n') };
}

export function branchTrackingSuffix(status: RepositoryStatus | null | undefined): string {
  if (!status?.upstream) return '';
  return [status.behind ? `↙${status.behind}` : '', status.ahead ? `↗${status.ahead}` : ''].filter(Boolean).join(' ');
}

export function changesViewBadge(statuses: readonly (RepositoryStatus | null | undefined)[]): RepositoryViewBadge {
  const changes = statuses.reduce((total, status) => total + (status?.changes.length ?? 0), 0);
  return {
    value: changes,
    tooltip: changes ? `${changes} changed file${changes === 1 ? '' : 's'} ready to commit` : 'No uncommitted file changes'
  };
}

export function operationLabel(operation: string): string {
  if (operation.startsWith('smart-pull')) return operation.endsWith('rebase') ? 'Smart updating with rebase…' : 'Smart updating…';
  if (operation.startsWith('smart-checkout')) return 'Smart checking out…';
  if (operation === 'stash') return 'Stashing changes…';
  if (operation === 'apply-stash' || operation === 'pop-stash') return 'Restoring stashed changes…';
  if (operation === 'drop-stash') return 'Dropping stash…';
  if (operation === 'pull-merge' || operation === 'checkout-update' || operation === 'update-branch') return 'Updating…';
  if (operation === 'pull-rebase') return 'Updating with rebase…';
  if (operation === 'fetch') return 'Fetching…';
  if (operation.startsWith('push')) return 'Pushing…';
  if (operation === 'commit') return 'Committing…';
  if (operation.startsWith('checkout')) return 'Checking out…';
  if (operation === 'stage') return 'Staging…';
  if (operation === 'unstage') return 'Unstaging…';
  if (operation === 'rollback') return 'Rolling back…';
  if (operation === 'merge') return 'Merging…';
  if (operation === 'rebase') return 'Rebasing…';
  if (operation === 'cherry-pick') return 'Cherry-picking…';
  if (operation === 'revert' || operation === 'revert-changes') return 'Reverting…';
  if (operation === 'reset') return 'Resetting…';
  if (operation === 'continue') return 'Continuing…';
  if (operation === 'abort') return 'Aborting…';
  if (operation === 'mark-resolved' || operation === 'restore-conflict' || operation.startsWith('accept-')) return 'Resolving conflicts…';
  return `${operation.replaceAll('-', ' ')}…`;
}

export function operationActivity(operation: string | null): string | null {
  if (!operation || ['stage', 'unstage', 'add-to-ignore', 'rollback', 'revert-changes', 'mark-resolved', 'restore-conflict', 'accept-ours', 'accept-theirs'].includes(operation)) return null;
  return operationLabel(operation);
}

function phaseLabel(phase: RepositoryStatus['phase']): string {
  if (phase === 'cherry-picking') return 'cherry-picking';
  return phase;
}
