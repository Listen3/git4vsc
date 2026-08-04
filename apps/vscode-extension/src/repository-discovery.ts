import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ignoredDirectories = new Set(['.git', 'node_modules']);

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

    await Promise.all(entries
      .filter(entry => entry.isDirectory() && !ignoredDirectories.has(entry.name))
      .map(entry => visit(join(directory, entry.name), depth + 1)));
  }

  await visit(resolve(workspaceRoot), 0);
  return roots.sort((left, right) => left.localeCompare(right));
}
