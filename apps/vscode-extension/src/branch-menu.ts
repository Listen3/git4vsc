import { basename } from 'node:path';
import * as vscode from 'vscode';
import type { GitRef, RepositoryStatus } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';
import { operationLabel } from './repository-status.js';
import { notifyUpdateResult } from './operation-notifications.js';
import { pickUpdateStrategy } from './update-strategy.js';
import { checkoutWithSmartFallback, createAndCheckoutWithSmartFallback, runSmartCheckoutFallback, updateWithSmartFallback } from './smart-operations.js';
import { gitResourceUri } from './git-uri.js';

type MenuAction = 'update' | 'commit' | 'push' | 'log' | 'stash' | 'stashes' | 'newBranch' | 'checkoutRevision' | 'resolve';
type RefAction = 'checkout' | 'checkoutUpdate' | 'update' | 'push' | 'log';

interface MenuItem extends vscode.QuickPickItem {
  action?: MenuAction;
  ref?: GitRef;
}

interface RefMenuItem extends vscode.QuickPickItem {
  action: RefAction;
}

export class BranchMenu {
  constructor(private readonly previewPush: (repository: RepositoryController, branch: string, remote: string, upstream?: string) => Promise<void>) {}

  async show(repository: RepositoryController): Promise<void> {
    const status = repository.snapshot.status;
    if (!status) return;
    const picked = await vscode.window.showQuickPick(this.items(status, repository.snapshot.operation), {
      title: `Git4VSC · ${basename(repository.root)}`,
      placeHolder: 'Search branches and actions',
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!picked) return;
    if (picked.action) await this.runAction(repository, picked.action);
    else if (picked.ref) await this.showRefActions(repository, picked.ref);
  }

  async update(repository: RepositoryController): Promise<void> {
    const status = repository.snapshot.status;
    if (!status?.branch || !status.upstream) {
      void vscode.window.showWarningMessage(`${status?.branch ?? 'Current branch'} has no tracked branch.`);
      return;
    }
    const [remote, branch] = splitRemoteBranch(status.upstream);
    const rebase = await pickUpdateStrategy();
    if (rebase === undefined) return;
    const before = status.head;
    if (!await updateWithSmartFallback(repository, remote, branch, rebase)) return;
    if (await this.resolveConflictsIfNeeded(repository)) return;
    await notifyUpdateResult(repository, before, status.upstream);
  }

  private items(status: RepositoryStatus, operation: string | null): MenuItem[] {
    const conflicts = status.changes.filter(change => change.conflict).length;
    const current = status.refs.find(ref => ref.type === 'local-branch' && ref.name === status.branch);
    const locals = status.refs.filter(ref => ref.type === 'local-branch' && ref !== current).sort(byName);
    const remotes = status.refs.filter(ref => ref.type === 'remote-branch').sort(byName);
    const tags = status.refs.filter(ref => ref.type === 'tag').sort(byName);
    const items: MenuItem[] = [];

    if (operation) items.push({ label: `$(sync~spin) ${operationLabel(operation)}`, description: 'Repository operation in progress' });
    if (conflicts) items.push({ label: `$(warning) Resolve Conflicts…`, description: `${conflicts} unresolved`, action: 'resolve' });
    items.push(
      { label: '$(sync) Update Project…', description: status.upstream ?? 'No tracked branch', detail: syncDetail(status), action: 'update' },
      { label: '$(check) Commit…', description: `${status.changes.length} changes`, action: 'commit' },
      { label: '$(cloud-upload) Push…', description: status.upstream ?? 'Select remote', action: 'push' },
      { label: '$(git-commit) Open Commit Log', action: 'log' },
      { label: '$(archive) Stash Changes...', description: status.changes.length ? `${status.changes.length} changes` : 'No local changes', action: 'stash' },
      { label: '$(list-tree) Stashes...', action: 'stashes' },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(add) New Branch…', action: 'newBranch' },
      { label: '$(git-branch) Checkout Tag or Revision…', action: 'checkoutRevision' }
    );

    if (current) {
      items.push(
        { label: 'Current', kind: vscode.QuickPickItemKind.Separator },
        { label: `$(star-full) ${current.name}`, description: current.upstream ?? status.upstream ?? '', detail: syncDetail(status), ref: current }
      );
    }
    appendRefs(items, 'Local', locals);
    appendRefs(items, 'Remote', remotes);
    appendRefs(items, 'Tags', tags);
    return items;
  }

  private async runAction(repository: RepositoryController, action: MenuAction): Promise<void> {
    if (action === 'update') return this.update(repository);
    if (action === 'commit') {
      await vscode.commands.executeCommand('git4vsc.openCommitView', repository);
      return;
    }
    if (action === 'push') return this.pushCurrent(repository);
    if (action === 'stash') return this.stashChanges(repository);
    if (action === 'stashes') return this.manageStashes(repository);
    if (action === 'log') {
      await vscode.commands.executeCommand('git4vsc.openLog', repository);
      return;
    }
    if (action === 'resolve') {
      await vscode.commands.executeCommand('git4vsc.resolveConflicts', repository);
      return;
    }
    if (action === 'newBranch') {
      const name = await vscode.window.showInputBox({ title: 'New Branch', prompt: 'Branch name', validateInput: value => value.trim() ? undefined : 'Enter a branch name' });
      if (name && await createAndCheckoutWithSmartFallback(repository, name.trim(), 'HEAD')) await this.resolveConflictsIfNeeded(repository);
      return;
    }
    const target = await vscode.window.showInputBox({ title: 'Checkout Tag or Revision', prompt: 'Tag, commit hash or revision' });
    if (target?.trim() && await checkoutWithSmartFallback(repository, target.trim(), true)) await this.resolveConflictsIfNeeded(repository);
  }

  async stashChanges(repository: RepositoryController): Promise<void> {
    if (!repository.snapshot.status?.changes.length) {
      void vscode.window.showInformationMessage('No local changes to stash.');
      return;
    }
    const scope = await vscode.window.showQuickPick([
      { label: 'Tracked and untracked files', includeUntracked: true, picked: true },
      { label: 'Tracked files only', includeUntracked: false }
    ], { title: 'Stash Changes', placeHolder: 'Choose which changes to stash' });
    if (!scope) return;
    const message = await vscode.window.showInputBox({ title: 'Stash Changes', prompt: 'Stash message', value: `Changes on ${repository.snapshot.status.branch ?? 'HEAD'}` });
    if (!message?.trim()) return;
    await repository.stashChanges(message.trim(), scope.includeUntracked);
    void vscode.window.showInformationMessage(`Stashed changes: ${message.trim()}`);
  }

  async manageStashes(repository: RepositoryController): Promise<void> {
    const stashes = await repository.git.stashes(repository.location);
    if (!stashes.length) {
      void vscode.window.showInformationMessage('No stashes in this repository.');
      return;
    }
    const picked = await vscode.window.showQuickPick(stashes.map(stash => ({
      label: `$(archive) ${stash.message}`,
      description: stash.ref,
      detail: [stash.branch, new Date(stash.authorTime * 1000).toLocaleString()].filter(Boolean).join(' · '),
      stash
    })), { title: 'Git Stashes', placeHolder: 'Select a stash' });
    if (!picked) return;
    const action = await vscode.window.showQuickPick([
      { label: '$(play) Apply', id: 'apply' },
      { label: '$(play) Apply and Reinstate Index', id: 'apply-index' },
      { label: '$(check) Pop', id: 'pop' },
      { label: '$(check) Pop and Reinstate Index', id: 'pop-index' },
      { label: '$(git-branch) Create Branch from Stash...', id: 'branch' },
      { label: '$(files) Show Changed Files', id: 'files' },
      { label: '$(trash) Drop...', id: 'drop' }
    ], { title: picked.stash.message, placeHolder: 'Select stash action' });
    if (!action) return;
    if (action.id === 'apply' || action.id === 'apply-index') await repository.applyStash(picked.stash.ref, action.id === 'apply-index');
    else if (action.id === 'pop' || action.id === 'pop-index') await repository.popStash(picked.stash.ref, action.id === 'pop-index');
    else if (action.id === 'branch') {
      const name = await vscode.window.showInputBox({ title: 'Create Branch from Stash', prompt: 'Branch name', validateInput: value => value.trim() ? undefined : 'Enter a branch name' });
      if (name?.trim()) await repository.createBranchFromStash(name.trim(), picked.stash.ref);
    } else if (action.id === 'files') {
      const files = await repository.git.stashChanges(repository.location, picked.stash.ref);
      const file = await vscode.window.showQuickPick(files.map(change => ({ label: change.path, description: change.status, change })), { title: picked.stash.message, placeHolder: 'Select a file to open its diff' });
      if (file) {
        const left = file.change.status === 'added' ? gitResourceUri(repository, file.change.path, null) : gitResourceUri(repository, file.change.originalPath ?? file.change.path, `${picked.stash.ref}^1`);
        let revision = picked.stash.ref;
        if (file.change.status !== 'deleted') {
          try { await repository.git.show(repository.location, file.change.path, revision); }
          catch { revision = `${picked.stash.ref}^3`; }
        }
        const right = file.change.status === 'deleted' ? gitResourceUri(repository, file.change.path, null) : gitResourceUri(repository, file.change.path, revision);
        await vscode.commands.executeCommand('vscode.diff', left, right, `${file.change.path} (${picked.stash.ref})`);
      }
    } else {
      const confirmed = await vscode.window.showWarningMessage(`Drop ${picked.stash.ref}?`, { modal: true, detail: picked.stash.message }, 'Drop');
      if (confirmed) await repository.dropStash(picked.stash.ref);
    }
    if (repository.snapshot.status?.changes.some(change => change.conflict)) await vscode.commands.executeCommand('git4vsc.resolveConflicts', repository);
  }

  private async showRefActions(repository: RepositoryController, ref: GitRef): Promise<void> {
    const current = ref.type === 'local-branch' && ref.name === repository.snapshot.status?.branch;
    const upstream = ref.type === 'local-branch' ? ref.upstream ?? await repository.git.branchUpstream(repository.location, ref.name) : null;
    const actions: RefMenuItem[] = [];
    if (!current) actions.push({ label: '$(git-branch) Checkout', action: 'checkout' });
    if (ref.type === 'local-branch' && upstream) {
      actions.push({ label: current ? '$(sync) Update from Tracked Branch' : '$(sync) Update Branch', description: upstream, action: current ? 'update' : 'checkoutUpdate' });
    }
    if (ref.type === 'local-branch') actions.push({ label: '$(cloud-upload) Push…', description: upstream ?? 'Select remote', action: 'push' });
    actions.push({ label: '$(git-commit) Open Commit Log', action: 'log' });

    const picked = await vscode.window.showQuickPick(actions, { title: ref.name, placeHolder: 'Select branch action' });
    if (!picked) return;
    if (picked.action === 'checkout') return this.checkout(repository, ref);
    if (picked.action === 'update') return this.update(repository);
    if (picked.action === 'checkoutUpdate' && upstream) {
      const before = ref.hash;
      if (!await runSmartCheckoutFallback(repository, ref.name, () => repository.checkoutAndUpdate(ref.name, upstream), () => repository.smartCheckoutAndUpdate(ref.name, upstream))) return;
      if (await this.resolveConflictsIfNeeded(repository)) return;
      await notifyUpdateResult(repository, before, upstream);
      return;
    }
    if (picked.action === 'push' && ref.type === 'local-branch') return this.push(repository, ref.name, upstream);
    await vscode.commands.executeCommand('git4vsc.openLog', repository);
  }

  async pushCurrent(repository: RepositoryController): Promise<void> {
    const status = repository.snapshot.status;
    if (!status?.branch) return;
    await this.push(repository, status.branch, status.upstream);
  }

  private async push(repository: RepositoryController, branch: string, upstream: string | null): Promise<void> {
    const preferred = upstream ? splitRemoteBranch(upstream)[0] : undefined;
    const remotes = await repository.git.remotes(repository.location);
    const remote = preferred ?? (remotes.length === 1
      ? remotes[0]
      : (await vscode.window.showQuickPick(remotes, { title: `Push ${branch}`, placeHolder: 'Select remote' })));
    if (!remote) {
      void vscode.window.showWarningMessage('This repository has no configured remote.');
      return;
    }
    await this.previewPush(repository, branch, remote, upstream ?? undefined);
  }

  private async checkout(repository: RepositoryController, ref: GitRef): Promise<void> {
    if (ref.type === 'local-branch') {
      if (await checkoutWithSmartFallback(repository, ref.name)) await this.resolveConflictsIfNeeded(repository);
      return;
    }
    if (ref.type === 'tag') {
      if (await checkoutWithSmartFallback(repository, ref.fullName, true)) await this.resolveConflictsIfNeeded(repository);
      return;
    }
    if (ref.type !== 'remote-branch') return;
    const name = ref.name.slice(ref.name.indexOf('/') + 1);
    const local = repository.snapshot.status?.refs.find(candidate => candidate.type === 'local-branch' && candidate.name === name);
    if (local) {
      if (await checkoutWithSmartFallback(repository, local.name)) await this.resolveConflictsIfNeeded(repository);
    } else if (await createAndCheckoutWithSmartFallback(repository, name, ref.fullName, true)) await this.resolveConflictsIfNeeded(repository);
  }

  private async resolveConflictsIfNeeded(repository: RepositoryController): Promise<boolean> {
    if (!repository.snapshot.status?.changes.some(change => change.conflict)) return false;
    await vscode.commands.executeCommand('git4vsc.resolveConflicts', repository);
    return true;
  }
}

function appendRefs(items: MenuItem[], title: string, refs: GitRef[]): void {
  if (!refs.length) return;
  items.push({ label: title, kind: vscode.QuickPickItemKind.Separator });
  items.push(...refs.map(ref => ({
    label: `${ref.type === 'tag' ? '$(tag)' : ref.type === 'remote-branch' ? '$(cloud)' : '$(git-branch)'} ${ref.name}`,
    description: ref.upstream ?? '',
    ref
  })));
}

function syncDetail(status: RepositoryStatus): string {
  if (!status.upstream) return 'No tracked branch';
  if (!status.ahead && !status.behind) return 'Up to date';
  return [status.ahead ? `${status.ahead} ahead` : '', status.behind ? `${status.behind} behind` : ''].filter(Boolean).join(' · ');
}

function splitRemoteBranch(value: string): [string, string] {
  const separator = value.indexOf('/');
  if (separator < 1) throw new Error(`Invalid remote branch: ${value}`);
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function byName(left: GitRef, right: GitRef): number {
  return left.name.localeCompare(right.name);
}
