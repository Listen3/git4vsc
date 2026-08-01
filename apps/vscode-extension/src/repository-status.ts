import type { RepositorySnapshot, RepositoryStatus } from '@git4vsc/shared-types';

export interface StatusBarPresentation {
  title: string;
  tooltip: string;
}

export function statusBarPresentation(snapshot: RepositorySnapshot): StatusBarPresentation {
  const status = snapshot.status;
  const branch = status?.branch ?? status?.head?.slice(0, 8) ?? 'HEAD';
  const conflicts = status?.changes.filter(change => change.conflict).length ?? 0;
  const operation = snapshot.operation ? operationLabel(snapshot.operation) : null;
  const sync = status?.upstream
    ? [status.ahead ? `↑${status.ahead}` : '', status.behind ? `↓${status.behind}` : ''].filter(Boolean).join(' ')
    : '';

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

export function operationLabel(operation: string): string {
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

function phaseLabel(phase: RepositoryStatus['phase']): string {
  if (phase === 'cherry-picking') return 'cherry-picking';
  return phase;
}
