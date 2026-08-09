import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function worktreePath(selected: string, branch: string): Promise<string> {
  if ((await readdir(selected)).length === 0) return selected;
  const child = join(selected, branch.replace(/[\\/]+/g, '-'));
  try {
    if ((await readdir(child)).length > 0) throw new Error(`Worktree folder is not empty: ${child}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return child;
    throw error;
  }
  return child;
}
