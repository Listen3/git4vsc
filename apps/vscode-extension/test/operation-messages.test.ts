import { describe, expect, it } from 'vitest';
import { changelistDeleteMessage, pushResultMessage, updateResultMessage } from '../src/operation-messages.js';

describe('operation result messages', () => {
  it('pluralizes update summaries', () => {
    expect(updateResultMessage(1, 1)).toBe('1 file updated in 1 commit.');
    expect(updateResultMessage(3, 2)).toBe('3 files updated in 2 commits.');
  });

  it('describes pushed commits and their target', () => {
    expect(pushResultMessage(2, 'origin/main')).toBe('Pushed 2 commits to origin/main.');
  });

  it('describes direct and confirmed changelist deletion', () => {
    expect(changelistDeleteMessage('Generated', 0, 'Changes')).toBe('Deleted empty changelist Generated.');
    expect(changelistDeleteMessage('Generated', 2, 'Changes')).toBe('Deleted changelist Generated. Moved 2 files to Changes.');
  });
});
