import { describe, expect, it } from 'vitest';
import { filterDialogItems } from '../src/DialogHost.js';

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
