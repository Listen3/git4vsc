import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { findWorkspaceRepositoryRoots, repositoryContainingPath } from '../src/repository-discovery.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('workspace repository discovery', () => {
  it('finds Git repositories from the workspace root through three nested directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git4vsc-discovery-'));
    temporaryDirectories.push(root);
    const repositories = [root, join(root, 'one'), join(root, 'groups', 'two'), join(root, 'groups', 'nested', 'three')];
    for (const repository of repositories) await mkdir(join(repository, '.git'), { recursive: true });
    await mkdir(join(root, 'groups', 'nested', 'deeper', 'four', '.git'), { recursive: true });

    expect(await findWorkspaceRepositoryRoots(root)).toEqual([...repositories].sort((left, right) => left.localeCompare(right)));
  });

  it('recognizes worktree .git files and skips node_modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git4vsc-discovery-'));
    temporaryDirectories.push(root);
    const worktree = join(root, 'worktree');
    await mkdir(worktree, { recursive: true });
    await writeFile(join(worktree, '.git'), 'gitdir: ../metadata\n');
    await mkdir(join(root, 'node_modules', 'ignored', '.git'), { recursive: true });

    expect(await findWorkspaceRepositoryRoots(root)).toEqual([worktree]);
  });

  it('skips dependency caches without hiding repositories in ordinary build directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git4vsc-discovery-'));
    temporaryDirectories.push(root);
    await Promise.all(['node_modules', '.next', '.cache'].map(directory => mkdir(join(root, directory, 'ignored', '.git'), { recursive: true })));
    const repositories = ['vendor', 'dist', 'build'].map(directory => join(root, directory));
    await Promise.all(repositories.map(repository => mkdir(join(repository, '.git'), { recursive: true })));

    expect(await findWorkspaceRepositoryRoots(root)).toEqual(repositories.sort((left, right) => left.localeCompare(right)));
  });

  it('uses the deepest repository containing an editor file', () => {
    const root = join('D:', 'workspace');
    const nested = join(root, 'packages', 'app');
    const repositories = [{ root }, { root: nested }];

    expect(repositoryContainingPath(repositories, join(nested, 'src', 'index.ts'))).toBe(repositories[1]);
    expect(repositoryContainingPath(repositories, join('D:', 'outside', 'index.ts'))).toBeUndefined();
  });
});
