import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot, RepositoryStatus } from '@git4vsc/shared-types';
import { branchTrackingSuffix, changesViewBadge, operationActivity, statusBarPresentation } from '../src/repository-status.js';

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

  it('counts uncommitted files across repositories, including deletions', () => {
    const changed = {
      ...status,
      changes: [
        { path: 'modified.ts', index: null, workingTree: 'modified' as const, conflict: false },
        { path: 'deleted.ts', index: 'deleted' as const, workingTree: null, conflict: false }
      ]
    };
    const untracked = {
      ...status,
      root: '/other',
      changes: [{ path: 'new.ts', index: null, workingTree: 'untracked' as const, conflict: false }]
    };
    expect(changesViewBadge([changed, untracked])).toEqual({ value: 3, tooltip: '3 changed files ready to commit' });
    expect(changesViewBadge([status, null])).toEqual({ value: 0, tooltip: 'No uncommitted file changes' });
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
