import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommitDetails, CommitFileChange, CommitPage, LogQuery, RepositoryPhase, RepositoryStatus } from '@git4vsc/shared-types';
import { CommandRunner } from './command-runner.js';
import { parseLog, parseNameStatus, parsePorcelainV2, parseRefs } from './parsers.js';

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

function parseVisibleRefs(output: string) {
  return parseRefs(output).filter(ref => ref.type !== 'remote-branch' || !ref.name.endsWith('/HEAD'));
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
      refs: parseVisibleRefs(refsResult.stdout)
    };
  }

  async log(location: RepositoryLocation, offset = 0, limit = 200, query: LogQuery = {}): Promise<CommitPage> {
    const hashSearch = query.text && /^[0-9a-f]{7,40}$/i.test(query.text) ? query.text : null;
    let resolvedHash: string | null = null;
    if (hashSearch) {
      try {
        resolvedHash = (await this.runner.run(['-C', location.root, 'rev-parse', '--verify', `${hashSearch}^{commit}`])).stdout.trim();
      } catch {
        return { commits: [], offset, hasMore: false };
      }
    }
    const args = [
      '-C', location.root, 'log', '--topo-order', '--date-order', '--parents', '--decorate=full', '-z',
      `--skip=${offset}`, `--max-count=${limit + 1}`,
      '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%ct%x00%s%x00%D'
    ];
    if (resolvedHash) args.push('--no-walk', resolvedHash);
    else {
      if (query.text) args.push('--regexp-ignore-case', `--grep=${query.text}`);
      args.push(query.ref ?? '--all');
    }
    const result = await this.runner.run(args);
    const commits = parseLog(result.stdout);
    return { commits: commits.slice(0, limit), offset, hasMore: commits.length > limit };
  }

  async commitDetails(location: RepositoryLocation, hash: string): Promise<CommitDetails> {
    const metadata = await this.runner.run([
      '-C', location.root, 'show', '--no-patch',
      '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B%x00', hash
    ]);
    const fields = metadata.stdout.split('\0');
    const parents = (fields[1] ?? '').split(' ').filter(Boolean);
    const diffArgs = parents[0]
      ? ['-C', location.root, 'diff', '--name-status', '-z', '-M', '-C', parents[0], hash, '--']
      : ['-C', location.root, 'diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', '-M', '-C', hash, '--'];
    const [diff, exactRefs, containingBranches] = await Promise.all([
      this.runner.run(diffArgs),
      this.runner.run(['-C', location.root, 'for-each-ref', `--points-at=${hash}`, '--format=%(refname)%09%(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags']),
      this.runner.run(['-C', location.root, 'for-each-ref', `--contains=${hash}`, '--format=%(refname)%09%(objectname)', 'refs/heads', 'refs/remotes'])
    ]);
    const message = (fields[8] ?? '').replace(/\r?\n$/, '');
    return {
      hash: fields[0] ?? hash,
      parents,
      authorName: fields[2] ?? '',
      authorEmail: fields[3] ?? '',
      authorTime: Number(fields[4] ?? 0),
      committerName: fields[5] ?? '',
      committerEmail: fields[6] ?? '',
      committerTime: Number(fields[7] ?? 0),
      subject: message.split(/\r?\n/, 1)[0] ?? '',
      message,
      refs: parseVisibleRefs(exactRefs.stdout),
      files: parseNameStatus(diff.stdout),
      containingBranches: parseVisibleRefs(containingBranches.stdout).map(ref => ref.name)
    };
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

  async show(location: RepositoryLocation, path: string, revision: string): Promise<string> {
    const resolvedSpec = revision === 'index' ? `:${path}` : `${revision}:${path}`;
    const result = await this.runner.run(['-C', location.root, 'show', resolvedSpec]);
    return result.stdout;
  }

  async changedFiles(location: RepositoryLocation, from: string, to: string): Promise<CommitFileChange[]> {
    const result = await this.runner.run(['-C', location.root, 'diff', '--name-status', '-z', '-M', '-C', from, to, '--']);
    return parseNameStatus(result.stdout);
  }

  async createBranch(location: RepositoryLocation, name: string, startPoint: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'branch', name, startPoint]);
  }

  async createTag(location: RepositoryLocation, name: string, startPoint: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'tag', name, startPoint]);
  }

  async checkout(location: RepositoryLocation, target: string, detach = false, track = false): Promise<void> {
    const args = ['-C', location.root, 'switch'];
    if (detach) args.push('--detach');
    if (track) args.push('--track');
    args.push(target);
    await this.runner.run(args);
  }

  async merge(location: RepositoryLocation, ref: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'merge', '--no-edit', ref]);
  }

  async cherryPick(location: RepositoryLocation, hash: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'cherry-pick', hash]);
  }

  async revert(location: RepositoryLocation, hash: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'revert', '--no-edit', hash]);
  }

  async reset(location: RepositoryLocation, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    await this.runner.run(['-C', location.root, 'reset', `--${mode}`, hash]);
  }
}
