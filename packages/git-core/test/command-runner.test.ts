import { describe, expect, it } from 'vitest';
import { GitCommandError, isLocalChangesOverwriteError, isPushRejectedError } from '../src/command-runner.js';

function error(stderr: string): GitCommandError {
  return new GitCommandError({ command: 'git', args: [], exitCode: 1, stdout: '', stderr });
}

describe('Git error classification', () => {
  it('distinguishes non-fast-forward push rejection from policy rejection', () => {
    expect(isPushRejectedError(error('! [rejected] main -> main (non-fast-forward)'))).toBe(true);
    expect(isPushRejectedError(error('remote: push declined due to repository rule violations'))).toBe(false);
  });

  it('recognizes local changes blocking checkout and update', () => {
    expect(isLocalChangesOverwriteError(error('Your local changes to the following files would be overwritten by checkout:'))).toBe(true);
    expect(isLocalChangesOverwriteError(error('Your local changes to the following files would be overwritten by merge:'))).toBe(true);
    expect(isLocalChangesOverwriteError(error('cannot pull with rebase: You have unstaged changes.'))).toBe(true);
    expect(isLocalChangesOverwriteError(error('The following untracked working tree files would be overwritten by checkout:'))).toBe(true);
  });
});
