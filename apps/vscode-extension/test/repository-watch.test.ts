import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRepositoryIndex, repositoryInvalidations } from '../src/repository-watch.js';

describe('repository file watching', () => {
  const root = join('repo', 'project');
  const gitDir = join(root, '.git');

  it('refreshes only worktree status when a source file changes', () => {
    expect(repositoryInvalidations(root, gitDir, join(root, 'src', 'index.ts'))).toEqual(['status']);
  });

  it('refreshes log and refs for branch metadata changes', () => {
    expect(repositoryInvalidations(root, gitDir, join(gitDir, 'refs', 'heads', 'main'))).toEqual(['status', 'refs', 'log']);
    expect(repositoryInvalidations(root, gitDir, join(gitDir, 'HEAD'))).toEqual(['status', 'refs', 'log']);
  });

  it('recognizes index changes but ignores temporary lock churn', () => {
    expect(repositoryInvalidations(root, gitDir, join(gitDir, 'index'))).toEqual(['status']);
    expect(isRepositoryIndex(gitDir, join(gitDir, 'index'))).toBe(true);
    expect(repositoryInvalidations(root, gitDir, join(gitDir, 'index.lock'))).toEqual([]);
  });
});
