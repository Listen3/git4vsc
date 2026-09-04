import { readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const ignoredDirectories = new Set(['.git', '.cache', '.next', '.pnpm', '.yarn', 'coverage', 'node_modules']);
const scanBatchSize = 8;

export async function findWorkspaceRepositoryRoots(workspaceRoot: string, maxDepth = 3): Promise<string[]> {
  const roots: string[] = [];

  async function visit(directory: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some(entry => entry.name === '.git' && (entry.isDirectory() || entry.isFile()))) roots.push(directory);
    if (depth >= maxDepth) return;

    const directories = entries.filter(entry => entry.isDirectory() && !ignoredDirectories.has(entry.name));
    for (let index = 0; index < directories.length; index += scanBatchSize) {
      await Promise.all(directories.slice(index, index + scanBatchSize).map(entry => visit(join(directory, entry.name), depth + 1)));
    }
  }

  await visit(resolve(workspaceRoot), 0);
  return roots.sort((left, right) => left.localeCompare(right));
}

export function repositoryContainingPath<T extends { root: string }>(repositories: readonly T[], file: string): T | undefined {
  return repositories
    .filter(repository => {
      const path = relative(repository.root, file);
      return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
    })
    .sort((left, right) => right.root.length - left.root.length)[0];
}
