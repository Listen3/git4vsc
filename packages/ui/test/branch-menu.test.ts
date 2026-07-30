import { describe, expect, it } from 'vitest';
import type { GitRef, RepositoryStatus } from '@git4vsc/shared-types';
import { buildBranchMenu } from '../src/BranchSidebar.js';

const refs: GitRef[] = [
  { name: 'main', fullName: 'refs/heads/main', hash: 'main-hash', type: 'local-branch' },
  { name: 'feature', fullName: 'refs/heads/feature', hash: 'feature-hash', type: 'local-branch', upstream: 'origin/feature' },
  { name: 'origin/feature', fullName: 'refs/remotes/origin/feature', hash: 'feature-hash', type: 'remote-branch', remote: 'origin' },
  { name: 'v1', fullName: 'refs/tags/v1', hash: 'tag-hash', type: 'tag' }
];

const status: RepositoryStatus = {
  root: '/repo',
  gitDir: '/repo/.git',
  head: 'main-hash',
  branch: 'main',
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  phase: 'normal',
  shallow: false,
  changes: [],
  refs
};

function actions(ref: GitRef, repositoryStatus: RepositoryStatus = status): string[] {
  const menu = buildBranchMenu(ref, repositoryStatus, []);
  expect(menu.every(item => !item.disabled)).toBe(true);
  return menu.filter(item => !item.separator).map(item => item.id);
}

describe('branch context menus', () => {
  it('shows only actions that apply to the current local branch', () => {
    expect(actions(refs[0]!)).toEqual([
      'copy', 'toggleFavorite', 'checkoutNew', 'newWorktree', 'diffLocal',
      'update', 'push', 'setUpstream', 'rename'
    ]);
  });

  it('hides update when the current branch has no upstream', () => {
    expect(actions(refs[0]!, { ...status, upstream: null })).not.toContain('update');
  });

  it('shows checkout and integration actions for another local branch', () => {
    expect(actions(refs[1]!)).toEqual([
      'copy', 'toggleFavorite', 'checkout', 'checkoutNew', 'checkoutRebase', 'checkoutUpdate', 'newWorktree',
      'compare', 'diffLocal', 'rebaseOnto', 'merge',
      'update', 'push', 'setUpstream', 'rename', 'delete'
    ]);
  });

  it('hides upstream-dependent actions for an untracked local branch', () => {
    const untracked = { ...refs[1]!, upstream: undefined };
    const ids = actions(untracked);
    expect(ids).not.toContain('checkoutUpdate');
    expect(ids).not.toContain('update');
  });

  it('shows remote checkout, integration, pull and deletion actions', () => {
    expect(actions(refs[2]!)).toEqual([
      'copy', 'toggleFavorite', 'checkout', 'checkoutNew', 'checkoutRebase', 'newWorktree',
      'compare', 'diffLocal', 'rebaseOnto', 'merge', 'pullRebase', 'pullMerge', 'delete'
    ]);
  });

  it('hides branch-only integration actions while detached', () => {
    const detached = { ...status, branch: null, upstream: null };
    const ids = actions(refs[2]!, detached);
    expect(ids).toEqual(['copy', 'toggleFavorite', 'checkout', 'checkoutNew', 'newWorktree', 'compare', 'diffLocal', 'delete']);
  });

  it('uses the tag-specific menu and protects the checked-out tag', () => {
    expect(actions(refs[3]!)).toEqual(['copy', 'checkout', 'newWorktree', 'diffLocal', 'merge', 'push', 'delete']);
    expect(actions(refs[3]!, { ...status, branch: null, upstream: null, head: 'tag-hash' })).toEqual([
      'copy', 'newWorktree', 'diffLocal', 'push'
    ]);
  });
});
