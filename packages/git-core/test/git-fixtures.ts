import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function configure(root: string): void {
  git(root, 'config', 'user.name', 'Git4VSC Test');
  git(root, 'config', 'user.email', 'git4vsc@example.test');
}

function commit(root: string, file: string, content: string, message: string): void {
  writeFileSync(join(root, file), content);
  git(root, 'add', '--', file);
  git(root, 'commit', '-m', message);
}

export interface FixtureSet {
  base: string;
  history: string;
  shallow: string;
  worktree: string;
  submoduleHost: string;
  cleanup(): void;
}

export function createFixtureSet(): FixtureSet {
  const base = mkdtempSync(join(tmpdir(), 'git4vsc-fixtures-'));
  const history = join(base, 'history');
  mkdirSync(history);
  git(history, 'init', '-b', 'main');
  configure(history);
  commit(history, 'base.txt', 'base', 'root');
  commit(history, 'line.txt', 'line', 'straight line');
  const branchPoint = git(history, 'rev-parse', 'HEAD');

  git(history, 'checkout', '-b', 'fast-forward');
  commit(history, 'ff.txt', 'ff', 'fast-forward commit');
  git(history, 'checkout', 'main');
  git(history, 'merge', 'fast-forward');

  git(history, 'checkout', '-b', 'feature');
  commit(history, 'feature.txt', 'feature', 'feature commit');
  git(history, 'checkout', 'main');
  commit(history, 'main.txt', 'main', 'main commit');
  git(history, 'merge', '--no-ff', 'feature', '-m', 'no-ff merge');

  const octopusBase = git(history, 'rev-parse', 'HEAD');
  for (const name of ['octo-a', 'octo-b', 'octo-c']) {
    git(history, 'checkout', '-b', name, octopusBase);
    commit(history, `${name}.txt`, name, `${name} commit`);
  }
  git(history, 'checkout', 'main');
  git(history, 'merge', 'octo-a', 'octo-b', 'octo-c', '-m', 'octopus merge');
  git(history, 'tag', 'v1');
  git(history, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

  git(history, 'checkout', '-b', 'rebased', branchPoint);
  commit(history, 'rebase.txt', 'before', 'before rebase');
  git(history, 'rebase', 'main');
  git(history, 'checkout', 'main');

  const worktree = join(base, 'worktree');
  git(history, 'worktree', 'add', '--detach', worktree, 'HEAD~1');

  const shallow = join(base, 'shallow');
  git(base, 'clone', '--depth', '1', pathToFileURL(history).href, shallow);

  const submodule = join(base, 'submodule');
  mkdirSync(submodule);
  git(submodule, 'init', '-b', 'main');
  configure(submodule);
  commit(submodule, 'module.txt', 'module', 'module root');
  const submoduleHost = join(base, 'submodule-host');
  mkdirSync(submoduleHost);
  git(submoduleHost, 'init', '-b', 'main');
  configure(submoduleHost);
  commit(submoduleHost, 'host.txt', 'host', 'host root');
  git(submoduleHost, '-c', 'protocol.file.allow=always', 'submodule', 'add', submodule, 'modules/sample');
  git(submoduleHost, 'commit', '-m', 'add submodule');

  return {
    base, history, shallow, worktree, submoduleHost,
    cleanup() {
      if (base.startsWith(tmpdir()) && base.includes('git4vsc-fixtures-')) rmSync(base, { recursive: true, force: true });
    }
  };
}

