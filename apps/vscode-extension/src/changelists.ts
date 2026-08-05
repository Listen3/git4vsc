import { randomUUID } from 'node:crypto';
import type { GitChange, LocalChangelist } from '@git4vsc/shared-types';

export interface ChangelistState {
  version: 1;
  activeId: string;
  lists: Omit<LocalChangelist, 'active' | 'paths'>[];
  assignments: Record<string, string>;
}

export const initialChangelistState = (): ChangelistState => ({
  version: 1,
  activeId: 'default',
  lists: [{ id: 'default', name: 'Changes', description: '' }],
  assignments: {}
});

export function normalizeChangelistState(value: unknown): ChangelistState {
  if (!value || typeof value !== 'object') return initialChangelistState();
  const input = value as Partial<ChangelistState>;
  const lists = Array.isArray(input.lists)
    ? input.lists.filter(isList).map(list => ({ id: list.id, name: list.name.trim(), description: list.description ?? '' }))
    : [];
  if (!lists.length) return initialChangelistState();
  const ids = new Set(lists.map(list => list.id));
  const activeId = typeof input.activeId === 'string' && ids.has(input.activeId) ? input.activeId : lists[0]!.id;
  const assignments = Object.fromEntries(Object.entries(input.assignments ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && ids.has(entry[1])));
  return { version: 1, activeId, lists, assignments };
}

export function synchronizeChangelists(state: ChangelistState, changes: readonly GitChange[]): boolean {
  let changed = false;
  const trackedPaths = new Set(changes.filter(change => change.workingTree !== 'untracked').map(change => change.path));
  for (const change of changes) {
    if (change.workingTree === 'untracked') continue;
    if (change.originalPath && state.assignments[change.originalPath] && !state.assignments[change.path]) {
      state.assignments[change.path] = state.assignments[change.originalPath]!;
      delete state.assignments[change.originalPath];
      changed = true;
    }
    if (!state.assignments[change.path]) {
      state.assignments[change.path] = state.activeId;
      changed = true;
    }
  }
  for (const path of Object.keys(state.assignments)) {
    if (!trackedPaths.has(path)) {
      delete state.assignments[path];
      changed = true;
    }
  }
  return changed;
}

export function changelistSnapshot(state: ChangelistState): LocalChangelist[] {
  return state.lists.map(list => ({
    ...list,
    active: list.id === state.activeId,
    paths: Object.keys(state.assignments).filter(path => state.assignments[path] === list.id).sort()
  }));
}

export function createChangelist(state: ChangelistState, name: string, description: string, active: boolean): string {
  const normalizedName = uniqueName(state, name);
  const id = randomUUID();
  state.lists.push({ id, name: normalizedName, description: description.trim() });
  if (active) state.activeId = id;
  return id;
}

export function updateChangelist(state: ChangelistState, id: string, name: string, description: string): void {
  const list = requiredList(state, id);
  list.name = uniqueName(state, name, id);
  list.description = description.trim();
}

export function setActiveChangelist(state: ChangelistState, id: string): void {
  requiredList(state, id);
  state.activeId = id;
}

export function movePathsToChangelist(state: ChangelistState, id: string, paths: readonly string[]): void {
  requiredList(state, id);
  for (const path of paths) state.assignments[path] = id;
}

export function removeChangelist(state: ChangelistState, id: string, targetId: string): void {
  if (state.lists.length === 1) throw new Error('The last changelist cannot be deleted.');
  requiredList(state, id);
  requiredList(state, targetId);
  if (id === targetId) throw new Error('Choose another changelist for the assigned files.');
  for (const path of Object.keys(state.assignments)) {
    if (state.assignments[path] === id) state.assignments[path] = targetId;
  }
  state.lists = state.lists.filter(list => list.id !== id);
  if (state.activeId === id) state.activeId = targetId;
}

function requiredList(state: ChangelistState, id: string) {
  const list = state.lists.find(candidate => candidate.id === id);
  if (!list) throw new Error('The changelist no longer exists.');
  return list;
}

function uniqueName(state: ChangelistState, name: string, exceptId?: string): string {
  const value = name.trim();
  if (!value) throw new Error('Enter a changelist name.');
  if (state.lists.some(list => list.id !== exceptId && list.name.localeCompare(value, undefined, { sensitivity: 'accent' }) === 0)) {
    throw new Error(`A changelist named ${value} already exists.`);
  }
  return value;
}

function isList(value: unknown): value is { id: string; name: string; description?: string } {
  if (!value || typeof value !== 'object') return false;
  const list = value as { id?: unknown; name?: unknown };
  return typeof list.id === 'string' && Boolean(list.id) && typeof list.name === 'string' && Boolean(list.name.trim());
}
