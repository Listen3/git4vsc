import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { CommitDetails, CommitFileChange, CommitPage, CommitSelection, CommitSummary, GitBlameLine, GitChange, GitDiffHunk, GitStashEntry, GitWorktree, LogQuery, MergeConflict, RepositoryPhase, RepositoryStatus } from '@git4vsc/shared-types';
import { CommandRunner, GitCommandError } from './command-runner.js';
import { parseBlame, parseLog, parseNameStatus, parsePorcelainV2, parseRefs, parseUnmergedIndex, parseWorktrees } from './parsers.js';
import { parseFilePatch, selectPatchHunks } from './partial-commit.js';

export interface RepositoryLocation {
  root: string;
  gitDir: string;
  commonDir?: string;
}

export interface CommitContextFile {
  path: string;
  originalPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  diff: string;
  truncated: boolean;
}

export interface CommitMessageContext {
  files: CommitContextFile[];
  recentRepositoryMessages: string[];
  recentUserMessages: string[];
}

const maxUntrackedFileSize = 1024 * 1024;
const maxDiffSize = 100_000;

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

function commitContextStatus(change: GitChange): CommitContextFile['status'] {
  if (change.index === 'renamed' || change.workingTree === 'renamed') return 'renamed';
  if (change.index === 'deleted' || change.workingTree === 'deleted') return 'deleted';
  if (change.index === 'added' || change.workingTree === 'added' || change.workingTree === 'untracked') return 'added';
  return 'modified';
}

function commitChangePaths(changes: readonly CommitFileChange[]): string[] {
  return [...new Set(changes.flatMap(change => [change.originalPath, change.path].filter((path): path is string => Boolean(path))))];
}

function selectionPaths(selections: readonly CommitSelection[]): string[] {
  return [...new Set(selections.flatMap(selection => [selection.originalPath, selection.path].filter((path): path is string => Boolean(path))))];
}

export class GitClient {
  constructor(readonly runner = new CommandRunner()) {}

  async discover(path: string): Promise<RepositoryLocation> {
    const [root, gitDir, commonDir] = await Promise.all([
      this.runner.run(['-C', path, 'rev-parse', '--show-toplevel']),
      this.runner.run(['-C', path, 'rev-parse', '--absolute-git-dir']),
      this.discoverCommonDir(path)
    ]);
    return { root: root.stdout.trim(), gitDir: gitDir.stdout.trim(), commonDir };
  }

  private async discoverCommonDir(path: string): Promise<string> {
    try {
      return (await this.runner.run(['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim();
    } catch (error) {
      if (!isUnsupportedRevParsePathFormat(error)) throw error;
      const commonDir = (await this.runner.run(['-C', path, 'rev-parse', '--git-common-dir'])).stdout.trim();
      return resolve(path, commonDir);
    }
  }

  async status(location: RepositoryLocation, includeMetadata = true): Promise<RepositoryStatus> {
    const [statusResult, refsResult, shallowResult] = await Promise.all([
      this.runner.run(['-C', location.root, 'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']),
      includeMetadata ? this.runner.run(['-C', location.root, 'for-each-ref', '--format=%(refname)%09%(objectname)%09%(upstream:short)%09%(upstream:trackshort)', 'refs/heads', 'refs/remotes', 'refs/tags']) : null,
      includeMetadata ? this.runner.run(['-C', location.root, 'rev-parse', '--is-shallow-repository']) : null
    ]);
    const parsed = parsePorcelainV2(statusResult.stdout);
    return {
      ...location,
      ...parsed,
      phase: await readPhase(location.gitDir, parsed.branch),
      shallow: shallowResult?.stdout.trim() === 'true',
      refs: refsResult ? parseVisibleRefs(refsResult.stdout) : []
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
      if (query.text || query.author) {
        args.push(query.regex ? '--extended-regexp' : '--fixed-strings');
        if (!query.text || !query.caseSensitive) args.push('--regexp-ignore-case');
      }
      if (query.text) args.push(`--grep=${query.text}`);
      if (query.author) args.push(`--author=${query.regex ? escapeRegExp(query.author) : query.author}`);
      if (query.since) args.push(`--since=${query.since}`);
      if (query.until) args.push(`--until=${query.until}`);
      if (query.followRenames && query.paths?.length === 1) args.push('--follow');
      args.push(query.ref ?? '--all');
      if (query.paths?.length) args.push('--', ...query.paths);
    }
    const result = await this.runner.run(args);
    const commits = parseLog(result.stdout);
    return { commits: commits.slice(0, limit), offset, hasMore: commits.length > limit };
  }

  async outgoingCommits(location: RepositoryLocation, branch: string, remote: string, upstream?: string): Promise<CommitSummary[]> {
    const result = await this.runner.run([
      '-C', location.root, 'log', '--topo-order', '--date-order', '--parents', '--decorate=full', '-z',
      '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%ct%x00%s%x00%D', branch, '--not', upstream ?? `--remotes=${remote}`
    ]);
    return parseLog(result.stdout);
  }

  async commitFiles(location: RepositoryLocation, commits: readonly CommitSummary[]): Promise<Map<string, CommitFileChange[]>> {
    if (!commits.length) return new Map();
    const hashes = new Set(commits.map(commit => commit.hash));
    const result = await this.runner.run([
      '-C', location.root, 'diff-tree', '--stdin', '--root', '--name-status', '-r', '-z', '-M', '-C'
    ], { input: `${commits.map(commit => [commit.hash, commit.parents[0]].filter(Boolean).join(' ')).join('\n')}\n` });
    const files = new Map<string, CommitFileChange[]>();
    let hash: string | null = null;
    let records: string[] = [];
    const flush = () => {
      if (hash && !files.has(hash)) files.set(hash, parseNameStatus(records.join('\0')));
      records = [];
    };
    for (const field of result.stdout.split('\0')) {
      if (hashes.has(field)) {
        flush();
        hash = field;
      } else if (hash) {
        records.push(field);
      }
    }
    flush();
    for (const commit of commits) files.set(commit.hash, files.get(commit.hash) ?? []);
    return files;
  }

  async commitCount(location: RepositoryLocation, range: string): Promise<number> {
    const result = await this.runner.run(['-C', location.root, 'rev-list', '--count', range]);
    return Number(result.stdout.trim());
  }

  async commitDetails(location: RepositoryLocation, hash: string, knownParents?: readonly string[]): Promise<CommitDetails> {
    const metadataRequest = this.runner.run([
      '-C', location.root, 'show', '--no-patch',
      '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B%x00', hash
    ]);
    const exactRefsRequest = this.runner.run(['-C', location.root, 'for-each-ref', `--points-at=${hash}`, '--format=%(refname)%09%(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags']);
    const containingBranchesRequest = this.runner.run(['-C', location.root, 'for-each-ref', `--contains=${hash}`, '--format=%(refname)%09%(objectname)', 'refs/heads', 'refs/remotes']);
    const metadata = knownParents ? undefined : await metadataRequest;
    const parents = knownParents ? [...knownParents] : (metadata!.stdout.split('\0')[1] ?? '').split(' ').filter(Boolean);
    const diffArgs = parents[0]
      ? ['-C', location.root, 'diff', '--name-status', '-z', '-M', '-C', parents[0], hash, '--']
      : ['-C', location.root, 'diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', '-M', '-C', hash, '--'];
    const [resolvedMetadata, diff, exactRefs, containingBranches] = await Promise.all([
      metadataRequest,
      this.runner.run(diffArgs),
      exactRefsRequest,
      containingBranchesRequest
    ]);
    const fields = resolvedMetadata.stdout.split('\0');
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

  async addToIgnore(location: RepositoryLocation, path: string): Promise<void> {
    const ignoreFile = join(location.root, '.gitignore');
    let contents = '';
    try { contents = await readFile(ignoreFile, 'utf8'); } catch { /* create below */ }
    const entry = path.replaceAll('\\', '/');
    if (contents.split(/\r?\n/).includes(entry)) return;
    await writeFile(ignoreFile, `${contents}${contents && !contents.endsWith('\n') ? '\n' : ''}${entry}\n`, 'utf8');
  }

  async rollbackChanges(location: RepositoryLocation, changes: readonly GitChange[]): Promise<void> {
    const unstage = changes.filter(change => change.index === 'added' || change.index === 'copied' || change.index === 'renamed').map(change => change.path);
    const restore = changes.flatMap(change => {
      if (change.index === 'added' || change.index === 'copied' || change.workingTree === 'added' || change.workingTree === 'untracked') return [];
      return [change.originalPath ?? change.path];
    });
    if (unstage.length) await this.runner.run(['-C', location.root, 'rm', '--cached', '-f', '--', ...unstage]);
    if (restore.length) await this.runner.run(['-C', location.root, 'restore', '--source=HEAD', '--staged', '--worktree', '--', ...restore]);
  }

  async revertCommitChanges(location: RepositoryLocation, parent: string | null, hash: string, changes: readonly CommitFileChange[]): Promise<void> {
    const patch = await this.commitPatch(location, parent, hash, changes);
    if (patch) await this.runner.run(['-C', location.root, 'apply', '--reverse', '--whitespace=nowarn'], { input: patch });
  }

  async cherryPickCommitChanges(location: RepositoryLocation, parent: string | null, hash: string, changes: readonly CommitFileChange[]): Promise<void> {
    const patch = await this.commitPatch(location, parent, hash, changes);
    if (patch) await this.runner.run(['-C', location.root, 'apply', '--3way', '--whitespace=nowarn'], { input: patch });
  }

  async getChangesFromRevision(location: RepositoryLocation, hash: string, changes: readonly CommitFileChange[]): Promise<void> {
    await this.runner.run(['-C', location.root, 'restore', `--source=${hash}`, '--worktree', '--', ...commitChangePaths(changes)]);
  }

  async commitPatch(location: RepositoryLocation, parent: string | null, hash: string, changes: readonly CommitFileChange[]): Promise<string> {
    const base = parent ?? (await this.runner.run(['-C', location.root, 'hash-object', '-t', 'tree', '--stdin'], { input: '' })).stdout.trim();
    const patch = await this.runner.run(['-C', location.root, 'diff', '--binary', '--full-index', base, hash, '--', ...commitChangePaths(changes)]);
    return patch.stdout;
  }

  async commit(location: RepositoryLocation, message: string, all = false): Promise<void> {
    if (all) await this.runner.run(['-C', location.root, 'add', '--all']);
    await this.runner.run(['-C', location.root, 'commit', '--file=-'], { input: message });
  }

  async commitPaths(location: RepositoryLocation, message: string, paths: readonly string[]): Promise<void> {
    await this.runner.run(['-C', location.root, 'add', '--', ...paths]);
    await this.runner.run(['-C', location.root, 'commit', '--only', '--file=-', '--', ...paths], { input: message });
  }

  async diffHunks(location: RepositoryLocation, path: string): Promise<GitDiffHunk[]> {
    const patch = await this.workingTreePatch(location, path);
    return parseFilePatch(patch).hunks.map(({ text: _text, ...hunk }) => hunk);
  }

  async commitSelections(location: RepositoryLocation, message: string, selections: readonly CommitSelection[]): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'git4vsc-index-'));
    const index = join(directory, 'index');
    const env = { GIT_INDEX_FILE: index };
    try {
      await this.runner.run(['-C', location.root, 'read-tree', 'HEAD'], { env });
      const wholeFiles = selectionPaths(selections.filter(selection => selection.hunkIds === undefined));
      if (wholeFiles.length) await this.runner.run(['-C', location.root, 'add', '--all', '--', ...wholeFiles], { env });

      const partialPatches: { path: string; patch: string }[] = [];
      for (const selection of selections) {
        if (selection.hunkIds === undefined) continue;
        const selected = selectPatchHunks(await this.workingTreePatch(location, selection.path), new Set(selection.hunkIds));
        if (selected) partialPatches.push({ path: selection.path, patch: selected });
      }
      if (partialPatches.length) {
        await this.runner.run(['-C', location.root, 'apply', '--cached', '--whitespace=nowarn'], { env, input: partialPatches.map(item => item.patch).join('') });
      }
      if (!wholeFiles.length && !partialPatches.length) throw new Error('Select at least one change block before committing.');

      await this.runner.run(['-C', location.root, 'commit', '--file=-'], { env, input: message });
      const resetPaths = await this.indexOrHeadPaths(location, wholeFiles);
      if (resetPaths.length) await this.runner.run(['-C', location.root, 'reset', '--mixed', 'HEAD', '--', ...resetPaths]);
      for (const item of partialPatches) await this.alignIndexAfterPartialCommit(location, item.path, item.patch);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async stashes(location: RepositoryLocation): Promise<GitStashEntry[]> {
    const result = await this.runner.run(['-C', location.root, 'stash', 'list', '--format=%gd%x1f%H%x1f%ct%x1f%gs%x1e']);
    return result.stdout.split('\x1e').map(record => record.trim()).filter(Boolean).map(record => {
      const [ref = '', hash = '', authorTime = '0', subject = ''] = record.split('\x1f');
      const match = /^(?:On|WIP on) ([^:]+):\s*(.*)$/.exec(subject);
      return { ref, hash, authorTime: Number(authorTime), branch: match?.[1] ?? '', message: match?.[2] ?? subject };
    });
  }

  async stashPush(location: RepositoryLocation, message: string, includeUntracked = true): Promise<GitStashEntry | null> {
    const before = await this.resolveOptionalRef(location, 'refs/stash');
    await this.runner.run(['-C', location.root, 'stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), '--message', message]);
    const after = await this.resolveOptionalRef(location, 'refs/stash');
    if (!after || after === before) return null;
    return (await this.stashes(location)).find(entry => entry.hash === after) ?? null;
  }

  async stashApply(location: RepositoryLocation, ref: string, reinstateIndex = false): Promise<void> {
    await this.runner.run(['-C', location.root, 'stash', 'apply', ...(reinstateIndex ? ['--index'] : []), ref]);
  }

  async stashPop(location: RepositoryLocation, ref: string, reinstateIndex = false): Promise<void> {
    await this.runner.run(['-C', location.root, 'stash', 'pop', ...(reinstateIndex ? ['--index'] : []), ref]);
  }

  async stashDrop(location: RepositoryLocation, ref: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'stash', 'drop', ref]);
  }

  async stashBranch(location: RepositoryLocation, branch: string, ref: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'stash', 'branch', branch, ref]);
  }

  async stashChanges(location: RepositoryLocation, ref: string): Promise<CommitFileChange[]> {
    try {
      const result = await this.runner.run(['-C', location.root, 'stash', 'show', '--include-untracked', '--name-status', '-z', '-M', '-C', ref]);
      return parseNameStatus(result.stdout);
    } catch (error) {
      if (!isUnsupportedStashShowIncludeUntracked(error)) throw error;
    }

    const tracked = await this.runner.run(['-C', location.root, 'stash', 'show', '--name-status', '-z', '-M', '-C', ref]);
    const untrackedCommit = await this.resolveOptionalRef(location, `${ref}^3`);
    if (!untrackedCommit) return parseNameStatus(tracked.stdout);
    const untracked = await this.runner.run([
      '-C', location.root, 'diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', '-M', '-C', untrackedCommit, '--'
    ]);
    return [...parseNameStatus(tracked.stdout), ...parseNameStatus(untracked.stdout)];
  }

  async rememberSmartStash(location: RepositoryLocation, hash: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'update-ref', 'refs/git4vsc/smart-stash', hash]);
  }

  async pendingSmartStash(location: RepositoryLocation): Promise<GitStashEntry | null> {
    const hash = await this.resolveOptionalRef(location, 'refs/git4vsc/smart-stash');
    return hash ? (await this.stashes(location)).find(entry => entry.hash === hash) ?? null : null;
  }

  async clearSmartStash(location: RepositoryLocation): Promise<void> {
    await this.runner.run(['-C', location.root, 'update-ref', '-d', 'refs/git4vsc/smart-stash']);
  }

  async commitMessageContext(location: RepositoryLocation, head: string | null, changes: readonly GitChange[]): Promise<CommitMessageContext> {
    const base = head ?? (await this.runner.run(['-C', location.root, 'hash-object', '-t', 'tree', '--stdin'], { input: '' })).stdout.trim();
    const files: CommitContextFile[] = [];
    for (const change of changes) {
      const diff = change.index === null && change.workingTree === 'untracked'
        ? await this.untrackedPatch(location, change.path)
        : (await this.runner.run([
          '-C', location.root, 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', base, '--',
          ...[change.originalPath, change.path].filter((path): path is string => Boolean(path))
        ])).stdout;
      files.push({
        path: change.path,
        ...(change.originalPath ? { originalPath: change.originalPath } : {}),
        status: commitContextStatus(change),
        diff: diff.length > maxDiffSize ? `${diff.slice(0, maxDiffSize)}\n... [diff truncated]\n` : diff,
        truncated: diff.length > maxDiffSize
      });
    }

    const recentRepositoryMessages = head ? (await this.log(location, 0, 5, { ref: 'HEAD' })).commits.map(commit => commit.subject) : [];
    let recentUserMessages: string[] = [];
    try {
      const author = (await this.runner.run(['-C', location.root, 'config', '--get', 'user.name'])).stdout.trim();
      if (head && author) recentUserMessages = (await this.log(location, 0, 5, { ref: 'HEAD', author })).commits.map(commit => commit.subject);
    } catch { /* Git user.name is optional. */ }
    return { files, recentRepositoryMessages, recentUserMessages };
  }

  async show(location: RepositoryLocation, path: string, revision: string): Promise<string> {
    const resolvedSpec = revision === 'index' ? `:${path}` : `${revision}:${path}`;
    const result = await this.runner.run(['-C', location.root, 'show', resolvedSpec]);
    return result.stdout;
  }

  private async untrackedPatch(location: RepositoryLocation, path: string): Promise<string> {
    const file = join(location.root, path);
    const size = (await stat(file)).size;
    const header = [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`];
    if (size > maxUntrackedFileSize) return `${header.join('\n')}\n\\ File too large to include (${Math.ceil(size / 1024)} KB)\n`;
    const content = await readFile(file);
    if (content.includes(0)) return `${header.join('\n')}\nBinary file omitted\n`;
    const text = content.toString('utf8');
    if (!text) return `${header.join('\n')}\n`;
    const lines = text.split(/\r?\n/);
    if (text.endsWith('\n')) lines.pop();
    return `${header.join('\n')}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}\n${text.endsWith('\n') ? '' : '\\ No newline at end of file\n'}`;
  }

  private async workingTreePatch(location: RepositoryLocation, path: string): Promise<string> {
    return (await this.runner.run(['-C', location.root, 'diff', '--binary', '--full-index', '--no-ext-diff', '--no-color', 'HEAD', '--', path])).stdout;
  }

  private async resolveOptionalRef(location: RepositoryLocation, ref: string): Promise<string | null> {
    try {
      return (await this.runner.run(['-C', location.root, 'rev-parse', '--verify', ref])).stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async indexOrHeadPaths(location: RepositoryLocation, paths: readonly string[]): Promise<string[]> {
    if (!paths.length) return [];
    const [index, head] = await Promise.all([
      this.runner.run(['-C', location.root, 'ls-files', '-z', '--', ...paths]),
      this.runner.run(['-C', location.root, 'ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', ...paths])
    ]);
    return [...new Set(`${index.stdout}\0${head.stdout}`.split('\0').filter(Boolean))];
  }

  private async alignIndexAfterPartialCommit(location: RepositoryLocation, path: string, patch: string): Promise<void> {
    try {
      await this.runner.run(['-C', location.root, 'apply', '--cached', '--whitespace=nowarn'], { input: patch });
    } catch {
      try {
        await this.runner.run(['-C', location.root, 'apply', '--cached', '--reverse', '--check'], { input: patch });
      } catch {
        await this.runner.run(['-C', location.root, 'reset', '--mixed', 'HEAD', '--', path]);
      }
    }
  }

  async conflicts(location: RepositoryLocation): Promise<MergeConflict[]> {
    const result = await this.runner.run(['-C', location.root, 'ls-files', '--unmerged', '-z']);
    return parseUnmergedIndex(result.stdout);
  }

  async acceptConflictSide(location: RepositoryLocation, paths: readonly string[], side: 'ours' | 'theirs'): Promise<void> {
    const conflicts = new Map((await this.conflicts(location)).map(conflict => [conflict.path, conflict]));
    const keep = paths.filter(path => conflicts.get(path)?.[side]);
    const remove = paths.filter(path => !conflicts.get(path)?.[side]);
    if (keep.length) {
      await this.runner.run(['-C', location.root, 'checkout', `--${side}`, '--', ...keep]);
      await this.runner.run(['-C', location.root, 'add', '--', ...keep]);
    }
    if (remove.length) await this.runner.run(['-C', location.root, 'rm', '-f', '--', ...remove]);
  }

  async markConflictResolved(location: RepositoryLocation, paths: readonly string[]): Promise<void> {
    await this.runner.run(['-C', location.root, 'add', '--', ...paths]);
  }

  async restoreConflict(location: RepositoryLocation, paths: readonly string[]): Promise<void> {
    await this.runner.run(['-C', location.root, 'checkout', '-m', '--', ...paths]);
  }

  async continueOperation(location: RepositoryLocation, phase: RepositoryPhase): Promise<void> {
    await this.runner.run(['-C', location.root, '-c', 'core.editor=true', operationCommand(phase), '--continue'], { env: { GIT_EDITOR: 'true' } });
  }

  async abortOperation(location: RepositoryLocation, phase: RepositoryPhase): Promise<void> {
    await this.runner.run(['-C', location.root, operationCommand(phase), '--abort']);
  }

  async changedFiles(location: RepositoryLocation, from: string, to?: string): Promise<CommitFileChange[]> {
    const result = await this.runner.run(['-C', location.root, 'diff', '--name-status', '-z', '-M', '-C', from, ...(to ? [to] : []), '--']);
    return parseNameStatus(result.stdout);
  }

  async createBranch(location: RepositoryLocation, name: string, startPoint: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'branch', name, startPoint]);
  }

  async createAndCheckoutBranch(location: RepositoryLocation, name: string, startPoint: string, track = false): Promise<void> {
    await this.runner.run(['-C', location.root, 'switch', '--create', name, ...(track ? ['--track'] : []), startPoint]);
  }

  async checkoutAndUpdate(location: RepositoryLocation, branch: string, upstream: string): Promise<void> {
    const [remote, remoteBranch] = splitRemoteBranch(upstream);
    await this.runner.run(['-C', location.root, 'switch', branch]);
    await this.runner.run(['-C', location.root, 'pull', '--no-rebase', '--no-edit', remote, remoteBranch]);
  }

  async checkoutAndRebase(location: RepositoryLocation, branch: string, currentBranch: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'rebase', currentBranch, branch]);
  }

  async checkoutRemoteAndRebase(location: RepositoryLocation, localBranch: string, remoteBranch: string, currentBranch: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'switch', '--create', localBranch, '--track', remoteBranch]);
    await this.runner.run(['-C', location.root, 'rebase', currentBranch]);
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

  async forceCheckout(location: RepositoryLocation, target: string, detach = false, track = false): Promise<void> {
    const args = ['-C', location.root, 'switch', '--discard-changes'];
    if (detach) args.push('--detach');
    if (track) args.push('--track');
    args.push(target);
    await this.runner.run(args);
  }

  async merge(location: RepositoryLocation, ref: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'merge', '--no-edit', ref]);
  }

  async rebase(location: RepositoryLocation, ref: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'rebase', ref]);
  }

  async renameBranch(location: RepositoryLocation, oldName: string, newName: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'branch', '--move', oldName, newName]);
  }

  async deleteBranch(location: RepositoryLocation, name: string, force = false): Promise<void> {
    await this.runner.run(['-C', location.root, 'branch', force ? '-D' : '-d', name]);
  }

  async deleteRemoteBranch(location: RepositoryLocation, remote: string, branch: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'push', remote, '--delete', branch]);
  }

  async deleteTag(location: RepositoryLocation, name: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'tag', '--delete', name]);
  }

  async remotes(location: RepositoryLocation): Promise<string[]> {
    const result = await this.runner.run(['-C', location.root, 'remote']);
    return result.stdout.split(/\r?\n/).filter(Boolean);
  }

  async fetchRemote(location: RepositoryLocation, remote?: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'fetch', ...(remote ? [remote] : ['--all'])]);
  }

  async addRemote(location: RepositoryLocation, name: string, url: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'remote', 'add', name, url]);
  }

  async setRemoteUrl(location: RepositoryLocation, name: string, url: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'remote', 'set-url', name, url]);
  }

  async removeRemote(location: RepositoryLocation, name: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'remote', 'remove', name]);
  }

  async remoteUrl(location: RepositoryLocation, name: string): Promise<string> {
    const result = await this.runner.run(['-C', location.root, 'remote', 'get-url', name]);
    return result.stdout.trim();
  }

  async branchUpstream(location: RepositoryLocation, branch: string): Promise<string | null> {
    const result = await this.runner.run(['-C', location.root, 'for-each-ref', '--format=%(upstream:short)', `refs/heads/${branch}`]);
    return result.stdout.trim() || null;
  }

  async setUpstream(location: RepositoryLocation, branch: string, upstream: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'branch', `--set-upstream-to=${upstream}`, branch]);
  }

  async updateBranch(location: RepositoryLocation, branch: string, upstream: string): Promise<void> {
    const separator = upstream.indexOf('/');
    if (separator < 1) throw new Error(`Invalid upstream branch: ${upstream}`);
    const remote = upstream.slice(0, separator);
    const remoteBranch = upstream.slice(separator + 1);
    await this.runner.run(['-C', location.root, 'fetch', remote, `${remoteBranch}:${branch}`]);
  }

  async pushBranch(location: RepositoryLocation, branch: string, remote: string, targetBranch = branch, force = false): Promise<void> {
    await this.runner.run(['-C', location.root, 'push', '--set-upstream', ...(force ? ['--force-with-lease'] : []), remote, `${branch}:refs/heads/${targetBranch}`]);
  }

  async blame(location: RepositoryLocation, path: string): Promise<GitBlameLine[]> {
    const result = await this.runner.run(['-C', location.root, 'blame', '--line-porcelain', '--', path]);
    return parseBlame(result.stdout);
  }

  async pullBranch(location: RepositoryLocation, remote: string, branch: string, rebase: boolean): Promise<void> {
    await this.runner.run(['-C', location.root, 'pull', rebase ? '--rebase' : '--no-rebase', ...(rebase ? [] : ['--no-edit']), remote, branch]);
  }

  async pushTag(location: RepositoryLocation, name: string, remote: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'push', remote, `refs/tags/${name}`]);
  }

  async worktrees(location: RepositoryLocation): Promise<GitWorktree[]> {
    let result;
    let usedCompatibilityFormat = false;
    try {
      result = await this.runner.run(['-C', location.root, 'worktree', 'list', '--porcelain', '-z']);
    } catch (error) {
      if (!isUnsupportedWorktreeNullTermination(error)) throw error;
      result = await this.runner.run(['-C', location.root, 'worktree', 'list', '--porcelain']);
      usedCompatibilityFormat = true;
    }
    const worktrees = parseWorktrees(result.stdout);
    return usedCompatibilityFormat ? this.enrichLegacyWorktreeMetadata(location, worktrees) : worktrees;
  }

  private async enrichLegacyWorktreeMetadata(location: RepositoryLocation, worktrees: GitWorktree[]): Promise<GitWorktree[]> {
    const metadataRoot = join(location.commonDir ?? location.gitDir, 'worktrees');
    let entries;
    try {
      entries = await readdir(metadataRoot, { withFileTypes: true });
    } catch {
      return worktrees;
    }

    const byPath = new Map(worktrees.map(worktree => [comparablePath(worktree.path), worktree]));
    await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
      const adminDir = join(metadataRoot, entry.name);
      let gitDirFile: string;
      try {
        gitDirFile = resolve(adminDir, (await readFile(join(adminDir, 'gitdir'), 'utf8')).trim());
      } catch {
        return;
      }
      const worktree = byPath.get(comparablePath(dirname(gitDirFile)));
      if (!worktree) return;

      try {
        const reason = (await readFile(join(adminDir, 'locked'), 'utf8')).trim();
        worktree.locked = true;
        if (reason) worktree.lockReason = reason;
      } catch {
        // An absent lock file means that the linked worktree is unlocked.
      }
      if (!worktree.locked && !(await exists(gitDirFile))) {
        worktree.prunable = true;
        worktree.pruneReason = 'gitdir file points to non-existent location';
      }
    }));
    return worktrees;
  }

  async addWorktree(location: RepositoryLocation, path: string, ref: string, newBranch?: string, detach = false): Promise<void> {
    const branchExisted = newBranch ? Boolean(await this.resolveOptionalRef(location, `refs/heads/${newBranch}`)) : false;
    try {
      await this.runner.run(['-C', location.root, 'worktree', 'add', ...(newBranch ? ['-b', newBranch] : detach ? ['--detach'] : []), path, ref]);
    } catch (error) {
      try {
        const branchCreated = newBranch && !branchExisted && await this.resolveOptionalRef(location, `refs/heads/${newBranch}`);
        if (branchCreated && !(await this.worktrees(location)).some(worktree => worktree.branch === newBranch)) {
          await this.deleteBranch(location, newBranch!, true);
        }
      } catch {
        // Preserve the original worktree creation error when best-effort cleanup fails.
      }
      throw error;
    }
  }

  async removeWorktree(location: RepositoryLocation, path: string, force = false): Promise<void> {
    await this.runner.run(['-C', location.root, 'worktree', 'remove', ...(force ? ['--force'] : []), path]);
  }

  async pruneWorktrees(location: RepositoryLocation): Promise<void> {
    await this.runner.run(['-C', location.root, 'worktree', 'prune']);
  }

  async lockWorktree(location: RepositoryLocation, path: string, reason?: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'worktree', 'lock', ...(reason ? ['--reason', reason] : []), path]);
  }

  async unlockWorktree(location: RepositoryLocation, path: string): Promise<void> {
    await this.runner.run(['-C', location.root, 'worktree', 'unlock', path]);
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

function isUnsupportedWorktreeNullTermination(error: unknown): boolean {
  if (!(error instanceof GitCommandError)) return false;
  const output = `${error.result.stdout}\n${error.result.stderr}`;
  return /(?:unknown switch [`'"]?z|unknown option [`'"]?(?:z|-z)|unrecognized option [`'"]?(?:z|-z))/i.test(output);
}

function isUnsupportedRevParsePathFormat(error: unknown): boolean {
  if (!(error instanceof GitCommandError)) return false;
  const output = `${error.result.stdout}\n${error.result.stderr}`;
  return /(?:unknown|unrecognized) option [`'"]?(?:--?)?path-format(?:=absolute)?/i.test(output);
}

function isUnsupportedStashShowIncludeUntracked(error: unknown): boolean {
  if (!(error instanceof GitCommandError)) return false;
  const output = `${error.result.stdout}\n${error.result.stderr}`;
  return /(?:unknown|unrecognized) option [`'"]?(?:--?)?include-untracked/i.test(output);
}

function comparablePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function escapeRegExp(value: string): string {
  const special = new Set(['\\', '.', '[', ']', '(', ')', '{', '}', '*', '+', '?', '|', '^', '$']);
  return [...value].map(character => special.has(character) ? `\\${character}` : character).join('');
}

function splitRemoteBranch(value: string): [string, string] {
  const separator = value.indexOf('/');
  if (separator < 1) throw new Error(`Invalid remote branch: ${value}`);
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function operationCommand(phase: RepositoryPhase): 'merge' | 'rebase' | 'cherry-pick' | 'revert' {
  if (phase === 'merging') return 'merge';
  if (phase === 'rebasing') return 'rebase';
  if (phase === 'cherry-picking') return 'cherry-pick';
  if (phase === 'reverting') return 'revert';
  throw new Error('No Git operation is in progress.');
}
