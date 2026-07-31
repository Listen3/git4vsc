import { describe, expect, it } from 'vitest';
import type { GitChange, RepositoryStatus } from '@git4vsc/shared-types';
import { changeGroups, changeTone, compareIdeaFiles, fileContextActions, repositorySyncIndicators, selectedChangeSummary } from '../webview/commit-app.js';

describe('commit change groups', () => {
  it('keeps tracked files in one stable group while selection changes', () => {
    const changes: GitChange[] = [
      { path: 'both.ts', index: 'modified', workingTree: 'modified', conflict: false },
      { path: 'new.ts', index: null, workingTree: 'untracked', conflict: false },
      { path: 'conflict.ts', index: 'unmerged', workingTree: 'unmerged', conflict: true }
    ];

    const groups = changeGroups(changes);

    expect(groups.map(group => group.id)).toEqual(['conflicts', 'changes', 'untracked']);
    expect(groups.find(group => group.id === 'changes')?.changes.map(change => change.path)).toEqual(['both.ts']);
    expect(groups.find(group => group.id === 'untracked')?.title).toBe('Unversioned Files');
  });

  it('uses IDEA-style semantic file colors without status letters', () => {
    expect(changeTone({ path: 'new.ts', index: 'added', workingTree: null, conflict: false })).toBe('added');
    expect(changeTone({ path: 'draft.ts', index: null, workingTree: 'untracked', conflict: false })).toBe('unversioned');
    expect(changeTone({ path: 'edit.ts', index: null, workingTree: 'modified', conflict: false })).toBe('modified');
    expect(changeTone({ path: 'gone.ts', index: null, workingTree: 'deleted', conflict: false })).toBe('deleted');
  });

  it('offers the compact file menu and enables actions by file state', () => {
    const untracked = fileContextActions({ path: 'draft.ts', index: null, workingTree: 'untracked', conflict: false });
    expect(untracked.map(item => item.label)).toEqual(['Commit File…', 'Rollback…', 'Delete…', 'Jump to Source', 'Add to VCS', 'Add to Ignore']);
    expect(untracked.find(item => item.action === 'rollbackFile')?.enabled).toBe(false);
    expect(untracked.find(item => item.action === 'addToVcs')?.enabled).toBe(true);
  });

  it('summarizes selected files by semantic change kind instead of total count', () => {
    const changes: GitChange[] = [
      { path: 'new.ts', index: null, workingTree: 'untracked', conflict: false },
      { path: 'edit.ts', index: null, workingTree: 'modified', conflict: false },
      { path: 'gone.ts', index: null, workingTree: 'deleted', conflict: false },
      { path: 'other.ts', index: null, workingTree: 'modified', conflict: false }
    ];
    expect(selectedChangeSummary(changes, new Set(['new.ts', 'edit.ts', 'gone.ts']))).toEqual({ added: 1, modified: 1, deleted: 1 });
  });

  it('matches IDEA flat-view ordering by natural file name before parent path', () => {
    const change = (path: string): GitChange => ({ path, index: null, workingTree: 'modified', conflict: false });
    const sorted = [change('z/file10.ts'), change('a/beta.ts'), change('x/file2.ts'), change('q/alpha.ts')].sort(compareIdeaFiles);
    expect(sorted.map(item => item.path)).toEqual(['q/alpha.ts', 'a/beta.ts', 'x/file2.ts', 'z/file10.ts']);
  });

  it('shows IDEA-style incoming and outgoing branch indicators', () => {
    const status = { upstream: 'origin/main', ahead: 2, behind: 3 } as RepositoryStatus;
    expect(repositorySyncIndicators(status)).toEqual([
      { kind: 'incoming', icon: '↙', label: '3 incoming commits from origin/main' },
      { kind: 'outgoing', icon: '↗', label: '2 outgoing commits to origin/main' }
    ]);
    expect(repositorySyncIndicators({ ...status, ahead: 0, behind: 0 })).toEqual([
      { kind: 'current', icon: '●', label: 'Up to date with origin/main' }
    ]);
    expect(repositorySyncIndicators({ ...status, upstream: null })).toEqual([]);
  });
});
