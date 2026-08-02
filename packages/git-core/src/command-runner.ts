import { spawn } from 'node:child_process';

export interface CommandResult {
  command: string;
  args: readonly string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  input?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export class GitCommandError extends Error {
  constructor(readonly result: CommandResult) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
    super(detail.replace(/^fatal:\s*/i, ''));
    this.name = 'GitCommandError';
  }
}

export function isPushRejectedError(error: unknown): boolean {
  if (!(error instanceof GitCommandError)) return false;
  const output = `${error.result.stdout}\n${error.result.stderr}`;
  return /(?:non-fast-forward|fetch first|stale info|tip of your current branch is behind)/i.test(output);
}

export function isLocalChangesOverwriteError(error: unknown): boolean {
  if (!(error instanceof GitCommandError)) return false;
  const output = `${error.result.stdout}\n${error.result.stderr}`;
  return /(?:local changes to the following files|untracked working tree files) would be overwritten by (?:checkout|merge|switch|rebase)|cannot pull with rebase:.*(?:unstaged|uncommitted) changes|cannot rebase:.*(?:unstaged|uncommitted) changes/is.test(output);
}

export class CommandRunner {
  constructor(readonly executable = 'git') {}

  run(args: readonly string[], options: RunOptions = {}): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          GIT_PAGER: 'cat',
          GIT_TERMINAL_PROMPT: '0',
          LC_ALL: 'C',
          LANG: 'C',
          ...options.env
        },
        windowsHide: true,
        signal: options.signal,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
      child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
      child.on('error', reject);
      child.on('close', code => {
        const result: CommandResult = {
          command: this.executable,
          args,
          exitCode: code ?? -1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8')
        };
        if (result.exitCode === 0) resolve(result);
        else reject(new GitCommandError(result));
      });

      if (options.input !== undefined) child.stdin.end(options.input);
      else child.stdin.end();
    });
  }
}
