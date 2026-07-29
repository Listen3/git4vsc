import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('uTools preload contract', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'preload.cjs'), 'utf8');

  it('exposes a frozen, narrow API without arbitrary process execution', () => {
    expect(source).toContain('window.git4vsc = Object.freeze');
    for (const method of ['chooseRepository', 'open', 'refresh', 'stage', 'commit', 'loadMore']) expect(source).toContain(`${method}(`);
    expect(source).not.toMatch(/\b(?:exec|execSync|spawn)\s*\(/);
    expect(source).not.toContain('window.require');
  });

  it('is readable CommonJS rather than generated/minified preload code', () => {
    expect(source).toContain("'use strict';");
    expect(source.split('\n').length).toBeGreaterThan(40);
    expect(source).toContain("require('@git4vsc/repo-state')");
  });

  it('freezes the runtime bridge and validates calls at the boundary', async () => {
    class FakeManager {
      get(): undefined { return undefined; }
      async open() { return { snapshot: { status: null, commits: [], operation: null, error: null, loading: new Set() } }; }
    }
    const context = {
      window: {} as { git4vsc?: Record<string, (...args: unknown[]) => unknown> },
      utools: { showOpenDialog: () => [] },
      require: () => ({ RepositoryManager: FakeManager }),
      TypeError,
      Error,
      Object,
      Boolean
    };
    runInNewContext(source, context);
    expect(Object.isFrozen(context.window.git4vsc)).toBe(true);
    expect(Object.keys(context.window.git4vsc ?? {})).toEqual(['chooseRepository', 'open', 'refresh', 'stage', 'commit', 'loadMore']);
    await expect(context.window.git4vsc!['open']!('')).rejects.toThrow('path must be a non-empty string');
  });
});
