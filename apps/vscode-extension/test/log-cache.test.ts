import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitPage } from '@git4vsc/shared-types';
import { LogCache } from '../src/log-cache.js';

describe('LogCache', () => {
  const folders: string[] = [];
  afterEach(async () => Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))));

  it('restores only a page matching the repository HEAD', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'git4vsc-log-cache-'));
    folders.push(folder);
    const cache = new LogCache(folder);
    const page: CommitPage = {
      offset: 0,
      hasMore: true,
      commits: [{ hash: 'aaaa', parents: [], authorName: 'Ada', authorEmail: 'ada@example.com', authorTime: 1, committerTime: 1, subject: 'cached', refs: [] }]
    };
    await cache.write('C:/repo', 'aaaa', page);
    expect(await cache.read('C:/repo', 'aaaa')).toEqual(page);
    expect(await cache.read('C:/repo', 'bbbb')).toBeNull();
  });
});
