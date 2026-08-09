import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommitPage, CommitSummary } from '@git4vsc/shared-types';

interface CachedLogPage {
  schema: 1;
  root: string;
  head: string;
  commits: CommitSummary[];
  hasMore: boolean;
}

export class LogCache {
  constructor(private readonly storagePath: string | undefined) {}

  async read(root: string, head: string): Promise<CommitPage | null> {
    if (!this.storagePath) return null;
    try {
      const cached = JSON.parse(await readFile(this.path(root), 'utf8')) as CachedLogPage;
      if (cached.schema !== 1 || cached.root !== root || cached.head !== head || !Array.isArray(cached.commits)) return null;
      return { commits: cached.commits, offset: 0, hasMore: cached.hasMore };
    } catch {
      return null;
    }
  }

  async write(root: string, head: string, page: CommitPage): Promise<void> {
    if (!this.storagePath) return;
    await mkdir(join(this.storagePath, 'log-cache'), { recursive: true });
    const cached: CachedLogPage = { schema: 1, root, head, commits: page.commits, hasMore: page.hasMore };
    await writeFile(this.path(root), JSON.stringify(cached), 'utf8');
  }

  private path(root: string): string {
    const id = createHash('sha256').update(root).digest('hex').slice(0, 24);
    return join(this.storagePath!, 'log-cache', `${id}.json`);
  }
}
