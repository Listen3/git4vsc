import { RepositoryController } from '@git4vsc/repo-state';

export async function checkedOutBranchRepository(repository: RepositoryController, branch: string): Promise<RepositoryController | null> {
  const worktree = repository.worktreeForBranch(branch, true);
  if (!worktree) return null;
  const target = new RepositoryController(repository.git, await repository.git.discover(worktree.path));
  await target.refresh();
  return target;
}

export async function refreshAfterLinkedWorktreeUpdate(repository: RepositoryController): Promise<void> {
  repository.invalidate('status', 'log', 'refs', 'worktrees');
  await repository.refresh();
}
