import { describe, expect, it } from 'vitest';
import { WebviewDialogController } from '../src/webview-dialog-controller.js';

describe('WebviewDialogController', () => {
  it('resolves the active request and rejects stale results', async () => {
    const messages: unknown[] = [];
    const controller = new WebviewDialogController(message => { messages.push(message); return Promise.resolve(true); });
    const result = controller.show({ kind: 'list', title: 'Choose', items: [{ id: 'one', label: 'One' }] });
    const id = (messages[0] as { dialog: { id: number } }).dialog.id;

    expect(controller.resolve(id + 1, 'stale')).toBe(false);
    expect(controller.resolve(id, 'one')).toBe(true);
    await expect(result).resolves.toBe('one');
  });

  it('cancels the previous request when another dialog opens', async () => {
    const controller = new WebviewDialogController(() => Promise.resolve(true));
    const first = controller.show({ kind: 'list', title: 'First', items: [] });
    void controller.show({ kind: 'list', title: 'Second', items: [] });
    await expect(first).resolves.toBeNull();
  });

  it('returns multiple paths from a path tree dialog', async () => {
    const messages: unknown[] = [];
    const controller = new WebviewDialogController(message => { messages.push(message); return Promise.resolve(true); });
    const result = controller.show({ kind: 'path-tree', title: 'Paths', entries: [], selectedPaths: [] });
    const id = (messages[0] as { dialog: { id: number } }).dialog.id;
    controller.resolve(id, ['src', 'README.md']);
    await expect(result).resolves.toEqual(['src', 'README.md']);
  });

  it('returns the selected option together with its text input', async () => {
    const messages: unknown[] = [];
    const controller = new WebviewDialogController(message => { messages.push(message); return Promise.resolve(true); });
    const result = controller.show({ kind: 'list', title: 'New Worktree', searchable: false, input: { label: 'Branch name', requiredFor: ['branch'] }, items: [{ id: 'branch', label: 'Create New Branch' }] });
    const id = (messages[0] as { dialog: { id: number } }).dialog.id;
    controller.resolve(id, { id: 'branch', input: 'feature/worktree' });
    await expect(result).resolves.toEqual({ id: 'branch', input: 'feature/worktree' });
  });
});
