import { describe, expect, it } from 'vitest';
import type { GitChange } from '@git4vsc/shared-types';
import { changeGroups, changeTone, compareIdeaFiles, fileContextActions, moveTargetChangelists, nextRowSelection, selectedChangeSummary } from '../webview/commit-app.js';

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

  it('groups tracked changes by changelist while keeping conflicts and unversioned files separate', () => {
    const changes: GitChange[] = [
      { path: 'src/active.ts', index: null, workingTree: 'modified', conflict: false },
      { path: 'generated/output.js', index: null, workingTree: 'modified', conflict: false },
      { path: 'draft.txt', index: null, workingTree: 'untracked', conflict: false }
    ];
    const groups = changeGroups(changes, [
      { id: 'default', name: 'Changes', description: '', active: true, paths: ['src/active.ts'] },
      { id: 'generated', name: 'Generated', description: '', active: false, paths: ['generated/output.js'] }
    ]);

    expect(groups.map(group => group.title)).toEqual(['Changes', 'Generated', 'Unversioned Files']);
    expect(groups[1]?.changes.map(change => change.path)).toEqual(['generated/output.js']);
  });

  it('uses IDEA-style semantic file colors without status letters', () => {
    expect(changeTone({ path: 'new.ts', index: 'added', workingTree: null, conflict: false })).toBe('added');
    expect(changeTone({ path: 'draft.ts', index: null, workingTree: 'untracked', conflict: false })).toBe('unversioned');
    expect(changeTone({ path: 'edit.ts', index: null, workingTree: 'modified', conflict: false })).toBe('modified');
    expect(changeTone({ path: 'gone.ts', index: null, workingTree: 'deleted', conflict: false })).toBe('deleted');
  });

  it('offers the compact file menu and enables actions by file state', () => {
    const untracked = fileContextActions({ path: 'draft.ts', index: null, workingTree: 'untracked', conflict: false });
    expect(untracked.map(item => item.label)).toEqual(['Commit File…', 'Move to Another Changelist…', 'Rollback…', 'Delete…', 'Jump to Source', 'Add to VCS', 'Add to Ignore']);
    expect(untracked.find(item => item.action === 'moveToChangelist')?.enabled).toBe(false);
    expect(untracked.find(item => item.action === 'rollbackFile')?.enabled).toBe(false);
    expect(untracked.find(item => item.action === 'addToVcs')?.enabled).toBe(true);
  });

  it('keeps row selection separate from commit checkboxes with native range semantics', () => {
    const order = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
    const single = nextRowSelection(order, new Set(), 'b.ts', null, false, false);
    const additive = nextRowSelection(order, single.selected, 'd.ts', single.anchor, true, false);
    const range = nextRowSelection(order, additive.selected, 'b.ts', additive.anchor, false, true);

    expect([...single.selected]).toEqual(['b.ts']);
    expect([...additive.selected]).toEqual(['b.ts', 'd.ts']);
    expect([...range.selected]).toEqual(['b.ts', 'c.ts', 'd.ts']);
  });

  it('describes multi-file context actions from highlighted rows', () => {
    const changes: GitChange[] = [
      { path: 'a.ts', index: null, workingTree: 'modified', conflict: false },
      { path: 'b.ts', index: null, workingTree: 'modified', conflict: false }
    ];
    const actions = fileContextActions(changes[0]!, changes);

    expect(actions.find(action => action.action === 'commitFile')?.label).toBe('Commit Files…');
    expect(actions.find(action => action.action === 'moveToChangelist')?.label).toBe('Move to Another Changelist…');
    expect(actions.find(action => action.action === 'rollbackFile')?.label).toBe('Rollback…');
  });

  it('opens create directly when moving from the only changelist', () => {
    const only = { id: 'default', name: 'Changes', description: '', active: true, paths: ['a.ts'] };
    const other = { id: 'other', name: 'Other', description: '', active: false, paths: [] };

    expect(moveTargetChangelists([only], ['a.ts'])).toEqual([]);
    expect(moveTargetChangelists([only, other], ['a.ts']).map(list => list.id)).toEqual(['other']);
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

});
