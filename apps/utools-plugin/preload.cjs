'use strict';

// This file intentionally remains readable CommonJS, as required by the uTools preload policy.
const { RepositoryManager } = require('@git4vsc/repo-state');

const manager = new RepositoryManager();

function text(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function repository(root) {
  const value = manager.get(text(root, 'root'));
  if (!value) throw new Error('Repository is not open');
  return value;
}

function snapshot(value) {
  return {
    status: value.snapshot.status,
    commits: value.snapshot.commits,
    operation: value.snapshot.operation,
    error: value.snapshot.error,
    loading: value.snapshot.loading.size > 0
  };
}

window.git4vsc = Object.freeze({
  async chooseRepository() {
    const selected = utools.showOpenDialog({ properties: ['openDirectory'] });
    return selected && selected[0] ? selected[0] : null;
  },
  async open(path) {
    const value = await manager.open(text(path, 'path'));
    return snapshot(value);
  },
  async refresh(root) {
    const value = repository(root);
    value.invalidate('status', 'log', 'refs');
    await value.refresh();
    return snapshot(value);
  },
  async stage(root, paths) {
    if (!Array.isArray(paths)) throw new TypeError('paths must be an array');
    const value = repository(root);
    await value.stage(paths.map(path => text(path, 'path')));
    return snapshot(value);
  },
  async commit(root, message, all) {
    const value = repository(root);
    await value.commit(text(message, 'message'), Boolean(all));
    return snapshot(value);
  },
  async loadMore(root) {
    const value = repository(root);
    await value.loadMore();
    return snapshot(value);
  }
});

