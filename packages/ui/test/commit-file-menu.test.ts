import { describe, expect, it } from 'vitest';
import { buildCommitFileMenu } from '../src/CommitDetailsPane.js';

describe('commit file context menu', () => {
  it('offers the common Git4Idea-style file actions', () => {
    const items = buildCommitFileMenu([{ path: 'src/app.ts', status: 'modified' }], true);
    expect(items.filter(item => !item.separator).map(item => item.id)).toEqual([
      'showDiff', 'showDiffNewTab', 'compareLocal', 'compareBeforeLocal', 'editSource', 'openRepositoryVersion',
      'revertSelected', 'cherryPickSelected', 'createPatch', 'getFromRevision', 'historyUpToHere', 'showChangesToParent', 'copyPath'
    ]);
  });

  it('disables single-file viewers for multi-selection and repository version for deletions', () => {
    const multiple = buildCommitFileMenu([{ path: 'a.ts', status: 'modified' }, { path: 'b.ts', status: 'added' }], false);
    expect(multiple.find(item => item.id === 'showDiff')?.disabled).toBe(true);
    expect(multiple.find(item => item.id === 'createPatch')?.disabled).toBeUndefined();

    const deleted = buildCommitFileMenu([{ path: 'old.ts', status: 'deleted' }], false);
    expect(deleted.find(item => item.id === 'openRepositoryVersion')?.disabled).toBe(true);
  });
});
