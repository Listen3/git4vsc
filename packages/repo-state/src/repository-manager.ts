import { GitClient } from '@git4vsc/git-core';
import { RepositoryController } from './repository-controller.js';

export class RepositoryManager {
  private readonly repositories = new Map<string, RepositoryController>();
  private readonly opening = new Map<string, Promise<RepositoryController>>();

  constructor(readonly git = new GitClient()) {}

  get all(): readonly RepositoryController[] {
    return [...this.repositories.values()];
  }

  get(root: string): RepositoryController | undefined {
    return this.repositories.get(root);
  }

  async open(path: string): Promise<RepositoryController> {
    const location = await this.git.discover(path);
    const repository = this.repositories.get(location.root);
    if (repository) return repository;
    const active = this.opening.get(location.root);
    if (active) return active;
    const opening = (async () => {
      const repository = new RepositoryController(this.git, location);
      await repository.refresh();
      this.repositories.set(location.root, repository);
      return repository;
    })();
    this.opening.set(location.root, opening);
    try {
      return await opening;
    } finally {
      this.opening.delete(location.root);
    }
  }
}
