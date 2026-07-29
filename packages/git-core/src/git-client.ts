import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommitPage, RepositoryPhase, RepositoryStatus } from '@git4vsc/shared-types';
import { CommandRunner } from './command-runner.js';
import { parseLog, parsePorcelainV2, parseRefs } from './parsers.js';

export interface RepositoryLocation {
  root: string;
  gitDir: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPhase(gitDir: string, branch: string | null): Promise<RepositoryPhase> {
  if (await exists(join(gitDir, 'MERGE_HEAD'))) return 'merging';
  if (await exists(join(gitDir, 'rebase-merge')) || await exists(join(gitDir, 'rebase-apply'))) return 'rebasing';
  if (await exists(join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-picking';
  if (await exists(join(gitDir, 'REVERT_HEAD'))) return 'reverting';
  return branch ? 'normal' : 'detached';
}

export class GitClient {
  constructor(readonly runner = new CommandRunner()) {}

  async discover(path: string): Promise<RepositoryLocation> {
    const [root, gitDir] = await Promise.all([
      this.runner.run(['-C', path, 'rev-parse', '--show-toplevel']),
      this.runner.run(['-C', path, 'rev-parse', '--absolute-git-dir'])
    ]);
    return { root: root.stdout.trim(), gitDir: gitDir.stdout.trim() };
  }

  async status(location: RepositoryLocation): Promise<RepositoryStatus> {
    const [statusResult, refsResult, shallowResult] = await Promise.all([
      this.runner.run(['-C', location.root, 'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']),
      this.runner.run(['-C', location.root, 'for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags']),
      this.runner.run(['-C', location.root, 'rev-parse', '--is-shallow-repository'])
    ]);
    const parsed = parsePorcelainV2(statusResult.stdout);
    return {
      ...location,
      ...parsed,
      phase: await readPhase(location.gitDir, parsed.branch),
      shallow: shallowResult.stdout.trim() === 'true',
      refs: parseRefs(refsResult.stdout)
    };
  }

  async log(location: RepositoryLocation, offset = 0, limit = 200): Promise<CommitPage> {
    const result = await this.runner.run([
      '-C', location.root, 'log', '--all', '--topo-order', '--date-order', '--parents', '--decorate=full', '-z',
      `--skip=${offset}`, `--max-count=${limit + 1}`,
      '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%ct%x00%s%x00%D'
    ]);
    const commits = parseLog(result.stdout);
    return { commits: commits.slice(0, limit), offset, hasMore: commits.length > limit };
  }

  async stage(location: RepositoryLocation, paths: readonly string[]): Promise<void> {
    await this.runner.run(['-C', location.root, 'add', '--', ...paths]);
  }

  async unstage(location: RepositoryLocation, paths: readonly string[]): Promise<void> {
    await this.runner.run(['-C', location.root, 'restore', '--staged', '--', ...paths]);
  }

  async commit(location: RepositoryLocation, message: string, all = false): Promise<void> {
    if (all) await this.runner.run(['-C', location.root, 'add', '--all']);
    await this.runner.run(['-C', location.root, 'commit', '--file=-'], { input: message });
  }

  async show(location: RepositoryLocation, path: string, revision: 'HEAD' | 'index'): Promise<string> {
    const spec = revision === 'index' ? `:${path}` : `HEAD:${path}`;
    const result = await this.runner.run(['-C', location.root, 'show', spec]);
    return result.stdout;
  }
}
