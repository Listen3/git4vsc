import { GitClient } from '@git4vsc/git-core';
import { RepositoryController } from './repository-controller.js';
import { resolve } from 'node:path';

export class RepositoryManager {
  private readonly repositories = new Map<string, RepositoryController>();
  private readonly opening = new Map<string, Promise<RepositoryController>>();

  constructor(readonly git = new GitClient()) {}

  get all(): readonly RepositoryController[] {
    return [...this.repositories.values()];
  }

  get(root: string): RepositoryController | undefined {
    return this.repositories.get(repositoryKey(root));
  }

  async open(path: string): Promise<RepositoryController> {
    const known = this.get(path);
    if (known) return known;
    const location = await this.git.discover(path);
    const key = repositoryKey(location.root);
    const repository = this.repositories.get(key);
    if (repository) return repository;
    const active = this.opening.get(key);
    if (active) return active;
    const opening = (async () => {
      const repository = new RepositoryController(this.git, location);
      await repository.refresh();
      this.repositories.set(key, repository);
      return repository;
    })();
    this.opening.set(key, opening);
    try {
      return await opening;
    } finally {
      this.opening.delete(key);
    }
  }
}

function repositoryKey(path: string): string {
  const key = resolve(path);
  return process.platform === 'win32' ? key.toLowerCase() : key;
}
