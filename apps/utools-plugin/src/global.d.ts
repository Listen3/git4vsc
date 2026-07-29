import type { CommitSummary, RepositoryStatus } from '@git4vsc/shared-types';

interface UToolsSnapshot {
  status: RepositoryStatus | null;
  commits: CommitSummary[];
  operation: string | null;
  error: string | null;
  loading: boolean;
}

interface Git4VscApi {
  chooseRepository(): Promise<string | null>;
  open(path: string): Promise<UToolsSnapshot>;
  refresh(root: string): Promise<UToolsSnapshot>;
  stage(root: string, paths: string[]): Promise<UToolsSnapshot>;
  commit(root: string, message: string, all: boolean): Promise<UToolsSnapshot>;
  loadMore(root: string): Promise<UToolsSnapshot>;
}

declare global { interface Window { git4vsc: Git4VscApi } }
export {};

