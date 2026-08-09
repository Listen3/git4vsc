import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { worktreePath } from '../src/worktree-path.js';

describe('worktreePath', () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

  it('uses an empty selected folder directly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git4vsc-worktree-'));
    roots.push(root);
    expect(await worktreePath(root, 'feature/test')).toBe(root);
  });

  it('creates a branch-named child under a non-empty folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git4vsc-worktree-'));
    roots.push(root);
    await writeFile(join(root, 'existing.txt'), 'occupied');
    expect(await worktreePath(root, 'feature/test')).toBe(join(root, 'feature-test'));
  });

  it('rejects an occupied branch-named child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git4vsc-worktree-'));
    roots.push(root);
    await writeFile(join(root, 'existing.txt'), 'occupied');
    const child = join(root, 'feature-test');
    await mkdir(child);
    await writeFile(join(child, 'existing.txt'), 'occupied');
    await expect(worktreePath(root, 'feature/test')).rejects.toThrow(`Worktree folder is not empty: ${child}`);
  });
});
