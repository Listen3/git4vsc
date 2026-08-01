import { describe, expect, it } from 'vitest';
import { filterDialogItems, updatePathTreeEntries } from '../src/DialogHost.js';

describe('dialog list filtering', () => {
  it('searches all item fields and removes empty groups', () => {
    const items = [
      { id: 'local', label: 'Local', separator: true },
      { id: 'main', label: 'main', description: 'current' },
      { id: 'remote', label: 'Remote', separator: true },
      { id: 'origin', label: 'origin/main', detail: 'tracked branch' }
    ];
    expect(filterDialogItems(items, 'tracked').map(item => item.id)).toEqual(['remote', 'origin']);
    expect(filterDialogItems(items, 'current').map(item => item.id)).toEqual(['local', 'main']);
  });
});

describe('path tree loading', () => {
  it('adds lazy children without replacing sibling nodes', () => {
    const entries = [
      { name: 'apps', path: 'apps', directory: true },
      { name: 'README.md', path: 'README.md', directory: false }
    ];
    expect(updatePathTreeEntries(entries, 'apps', [{ name: 'web', path: 'apps/web', directory: true }])).toEqual([
      { name: 'apps', path: 'apps', directory: true, children: [{ name: 'web', path: 'apps/web', directory: true }] },
      entries[1]
    ]);
  });
});
