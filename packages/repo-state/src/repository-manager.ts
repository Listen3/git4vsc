import { GitClient } from '@git4vsc/git-core';
import { RepositoryController } from './repository-controller.js';

export class RepositoryManager {
  private readonly repositories = new Map<string, RepositoryController>();

  constructor(readonly git = new GitClient()) {}

  get all(): readonly RepositoryController[] {
    return [...this.repositories.values()];
  }

  get(root: string): RepositoryController | undefined {
    return this.repositories.get(root);
  }

  async open(path: string): Promise<RepositoryController> {
    const location = await this.git.discover(path);
    let repository = this.repositories.get(location.root);
    if (!repository) {
      repository = new RepositoryController(this.git, location);
      this.repositories.set(location.root, repository);
      await repository.refresh();
    }
    return repository;
  }
}

