export type RepositoryPhase =
  | 'normal'
  | 'merging'
  | 'rebasing'
  | 'cherry-picking'
  | 'reverting'
  | 'detached';

export type ChangeCode =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'unmerged'
  | 'untracked';

export interface GitChange {
  path: string;
  originalPath?: string;
  index: ChangeCode | null;
  workingTree: ChangeCode | null;
  conflict: boolean;
}

export interface GitRef {
  name: string;
  fullName: string;
  hash: string;
  type: 'head' | 'local-branch' | 'remote-branch' | 'tag';
  remote?: string;
}

export interface RepositoryStatus {
  root: string;
  gitDir: string;
  head: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  phase: RepositoryPhase;
  shallow: boolean;
  changes: GitChange[];
  refs: GitRef[];
}

export interface CommitSummary {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorTime: number;
  committerTime: number;
  subject: string;
  refs: GitRef[];
}

export interface CommitPage {
  commits: CommitSummary[];
  offset: number;
  hasMore: boolean;
}

export type RepositoryInvalidation = 'status' | 'log' | 'refs';

export interface RepositorySnapshot {
  status: RepositoryStatus | null;
  commits: CommitSummary[];
  loading: ReadonlySet<RepositoryInvalidation>;
  operation: string | null;
  error: string | null;
  version: number;
}

