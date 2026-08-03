import { isAbsolute, relative, resolve } from 'node:path';
import type { RepositoryInvalidation } from '@git4vsc/shared-types';

export function repositoryInvalidations(root: string, gitDir: string, changedPath: string): RepositoryInvalidation[] {
  const gitPath = childPath(gitDir, changedPath);
  if (gitPath !== null) {
    if (gitPath === 'index') return ['status'];
    if (gitPath === 'HEAD' || gitPath === 'packed-refs' || gitPath === 'config' || gitPath.startsWith('refs/') || /^(MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|rebase-|sequencer\/)/.test(gitPath)) {
      return ['status', 'refs', 'log'];
    }
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
