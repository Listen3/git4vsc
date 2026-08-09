import { isAbsolute, relative, resolve } from 'node:path';
import type { RepositoryInvalidation } from '@git4vsc/shared-types';

export function repositoryInvalidations(root: string, gitDir: string, changedPath: string, commonDir = gitDir): RepositoryInvalidation[] {
  const gitPath = childPath(gitDir, changedPath);
  if (gitPath !== null) {
    if (gitPath === 'index') return ['status'];
    if (gitPath.startsWith('worktrees/')) return ['worktrees', 'refs', 'log'];
    if (gitPath === 'HEAD' || gitPath === 'packed-refs' || gitPath === 'config' || gitPath.startsWith('refs/') || /^(MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|rebase-|sequencer\/)/.test(gitPath)) {
      return resolve(gitDir) === resolve(commonDir) ? ['status', 'refs', 'log'] : ['status', 'refs', 'log', 'worktrees'];
    }
    return [];
  }
  const commonPath = childPath(commonDir, changedPath);
  if (commonPath !== null) {
    if (commonPath.startsWith('worktrees/')) return ['worktrees', 'refs', 'log'];
    if (commonPath === 'packed-refs' || commonPath === 'config' || commonPath.startsWith('refs/')) return ['status', 'refs', 'log'];
    return [];
  }
  return childPath(root, changedPath) === null ? [] : ['status'];
}

export function isRepositoryIndex(gitDir: string, changedPath: string): boolean {
  return childPath(gitDir, changedPath) === 'index';
}

function childPath(parent: string, child: string): string | null {
  const value = relative(resolve(parent), resolve(child));
  if (value.startsWith('..') || isAbsolute(value)) return null;
  return value.replaceAll('\\', '/');
}
