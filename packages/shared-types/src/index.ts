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

export type MergeConflictKind =
  | 'both-modified'
  | 'both-added'
  | 'deleted-by-us'
  | 'deleted-by-them'
  | 'added-by-us'
  | 'added-by-them'
  | 'both-deleted';

export interface MergeConflict {
  path: string;
  kind: MergeConflictKind;
  base: boolean;
  ours: boolean;
  theirs: boolean;
}

export interface GitRef {
  name: string;
  fullName: string;
  hash: string;
  type: 'head' | 'local-branch' | 'remote-branch' | 'tag';
  remote?: string;
  upstream?: string;
  tracking?: 'ahead' | 'behind' | 'diverged' | 'equal';
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

export interface LogQuery {
  ref?: string;
  text?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  author?: string;
  since?: string;
  until?: string;
  paths?: string[];
}

export type LogDateFilter = 'all' | 'today' | 'yesterday' | 'week' | 'month';

export interface LogFilters {
  text: string;
  regex: boolean;
  caseSensitive: boolean;
  user: string;
  date: LogDateFilter;
  path: string;
}

export interface CommitFileChange {
  path: string;
  originalPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'unmerged';
}

export interface CommitDetails extends CommitSummary {
  message: string;
  committerName: string;
  committerEmail: string;
  files: CommitFileChange[];
  containingBranches: string[];
}

export interface DialogListItem {
  id: string;
  label?: string;
  description?: string;
  detail?: string;
  separator?: boolean;
}

export interface ListDialogRequest {
  id: number;
  kind: 'list';
  title: string;
  placeholder?: string;
  acceptLabel?: string;
  items: DialogListItem[];
}

export interface PushPreviewCommit {
  commit: CommitSummary;
  files: CommitFileChange[];
}

export interface PushPreviewDialogRequest {
  id: number;
  kind: 'push-preview';
  title: string;
  source: string;
  remote: string;
  targetBranch: string;
  target: string;
  existingTargetBranches: string[];
  commits: PushPreviewCommit[];
}

export interface GitBlameLine {
  hash: string;
  line: number;
  authorName: string;
  authorEmail: string;
  authorTime: number;
  summary: string;
}

export interface PathTreeEntry {
  name: string;
  path: string;
  directory: boolean;
  children?: PathTreeEntry[];
}

export interface PathTreeDialogRequest {
  id: number;
  kind: 'path-tree';
  title: string;
  entries: PathTreeEntry[];
  selectedPaths: string[];
}

export type WebviewDialogRequest = ListDialogRequest | PushPreviewDialogRequest | PathTreeDialogRequest;

export interface WebviewDialogResult {
  id: number;
  value: string | string[] | null;
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
