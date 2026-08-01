import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot, RepositoryStatus } from '@git4vsc/shared-types';
import { branchTrackingSuffix, operationActivity, statusBarPresentation } from '../src/repository-status.js';

const status: RepositoryStatus = {
  root: '/repo',
  gitDir: '/repo/.git',
  head: '1234567890',
  branch: 'main',
  upstream: 'origin/main',
  ahead: 1,
  behind: 3,
  phase: 'normal',
  shallow: false,
  changes: [],
  refs: []
};

function snapshot(patch: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return { status, commits: [], loading: new Set(), operation: null, error: null, version: 1, ...patch };
}

describe('repository status bar presentation', () => {
  it('shows tracked branch divergence', () => {
    const presentation = statusBarPresentation(snapshot());
    expect(presentation.title).toBe('main ↙3 ↗1');
    expect(presentation.tooltip).toContain('Tracks origin/main · ahead 1 · behind 3');
    expect(branchTrackingSuffix(status)).toBe('↙3 ↗1');
    expect(branchTrackingSuffix({ ...status, ahead: 0, behind: 0 })).toBe('');
    expect(branchTrackingSuffix({ ...status, upstream: null })).toBe('');
  });

  it('shows the active repository operation', () => {
    expect(statusBarPresentation(snapshot({ operation: 'pull-merge' })).title).toBe('$(sync~spin) Updating…');
    expect(operationActivity('pull-merge')).toBe('Updating…');
    expect(operationActivity('stage')).toBeNull();
  });

  it('promotes unresolved conflicts', () => {
    const conflictStatus: RepositoryStatus = {
      ...status,
      phase: 'merging',
      changes: [{ path: 'conflict.ts', index: 'unmerged', workingTree: 'unmerged', conflict: true }]
    };
    const presentation = statusBarPresentation(snapshot({ status: conflictStatus }));
    expect(presentation.title).toBe('$(warning) main · 1');
    expect(presentation.tooltip).toContain('1 unresolved conflict');
    expect(presentation.tooltip).toContain('Repository state: merging');
  });
});
