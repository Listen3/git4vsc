import { describe, expect, it } from 'vitest';
import type { GitChange } from '@git4vsc/shared-types';
import {
  changelistSnapshot,
  createChangelist,
  initialChangelistState,
  movePathsToChangelist,
  normalizeChangelistState,
  removeChangelist,
  setActiveChangelist,
  synchronizeChangelists,
  updateChangelist
} from '../src/changelists.js';

const modified = (path: string, originalPath?: string): GitChange => ({ path, ...(originalPath ? { originalPath } : {}), index: null, workingTree: 'modified', conflict: false });

describe('changelists', () => {
  it('assigns newly observed tracked changes to the active changelist', () => {
    const state = initialChangelistState();
    const feature = createChangelist(state, 'Feature', 'Work in progress', true);

    expect(synchronizeChangelists(state, [modified('src/feature.ts')])).toBe(true);
    expect(state.assignments['src/feature.ts']).toBe(feature);
    expect(changelistSnapshot(state).find(list => list.id === feature)).toMatchObject({ active: true, paths: ['src/feature.ts'] });
  });

  it('moves assignments, renames lists, and remaps files when deleting a list', () => {
    const state = initialChangelistState();
    const feature = createChangelist(state, 'Feature', '', false);
    movePathsToChangelist(state, feature, ['src/a.ts', 'src/b.ts']);
    updateChangelist(state, feature, 'Feature A', 'Ready later');
    setActiveChangelist(state, feature);

    removeChangelist(state, feature, 'default');

    expect(state.activeId).toBe('default');
    expect(state.assignments).toEqual({ 'src/a.ts': 'default', 'src/b.ts': 'default' });
    expect(state.lists.map(list => list.name)).toEqual(['Changes']);
  });

  it('keeps a recurring generated change in its inactive changelist while it remains modified', () => {
    const state = initialChangelistState();
    synchronizeChangelists(state, [modified('src/app.ts'), modified('dist/bundle.js')]);
    const generated = createChangelist(state, 'Generated', 'Do not commit', false);
    movePathsToChangelist(state, generated, ['dist/bundle.js']);

    synchronizeChangelists(state, [modified('src/app.ts'), modified('dist/bundle.js')]);

    expect(state.assignments).toEqual({ 'src/app.ts': 'default', 'dist/bundle.js': generated });
  });

  it('migrates renamed paths and forgets assignments after changes disappear', () => {
    const state = initialChangelistState();
    state.assignments['old.ts'] = 'default';

    synchronizeChangelists(state, [modified('new.ts', 'old.ts')]);
    expect(state.assignments).toEqual({ 'new.ts': 'default' });

    synchronizeChangelists(state, []);
    expect(state.assignments).toEqual({});
  });

  it('repairs invalid persisted state and rejects duplicate names', () => {
    expect(normalizeChangelistState({ version: 1, activeId: 'missing', lists: [{ id: 'one', name: 'One' }], assignments: { a: 'missing' } })).toEqual({
      version: 1,
      activeId: 'one',
      lists: [{ id: 'one', name: 'One', description: '' }],
      assignments: {}
    });
    const state = initialChangelistState();
    expect(() => createChangelist(state, 'changes', '', false)).toThrow(/already exists/);
  });
});
