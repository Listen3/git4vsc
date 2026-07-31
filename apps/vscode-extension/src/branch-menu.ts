import { basename } from 'node:path';
import * as vscode from 'vscode';
import type { GitRef, RepositoryStatus } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';
import { operationLabel } from './repository-status.js';

type MenuAction = 'update' | 'commit' | 'push' | 'log' | 'newBranch' | 'checkoutRevision' | 'resolve';
type RefAction = 'checkout' | 'checkoutUpdate' | 'update' | 'push' | 'log';

interface MenuItem extends vscode.QuickPickItem {
  action?: MenuAction;
  ref?: GitRef;
}

interface RefMenuItem extends vscode.QuickPickItem {
  action: RefAction;
}

export class BranchMenu {
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
    await repository.pullBranch(remote, branch, false);
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
      if (name) await repository.createAndCheckoutBranch(name.trim(), 'HEAD');
      return;
    }
    const target = await vscode.window.showInputBox({ title: 'Checkout Tag or Revision', prompt: 'Tag, commit hash or revision' });
    if (target?.trim()) await repository.checkout(target.trim(), true);
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
      await repository.checkoutAndUpdate(ref.name, upstream);
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
    await repository.pushBranch(branch, remote);
  }

  private async checkout(repository: RepositoryController, ref: GitRef): Promise<void> {
    if (ref.type === 'local-branch') {
      await repository.checkout(ref.name);
      return;
    }
    if (ref.type === 'tag') {
      await repository.checkout(ref.fullName, true);
      return;
    }
    if (ref.type !== 'remote-branch') return;
    const name = ref.name.slice(ref.name.indexOf('/') + 1);
    const local = repository.snapshot.status?.refs.find(candidate => candidate.type === 'local-branch' && candidate.name === name);
    if (local) await repository.checkout(local.name);
    else await repository.createAndCheckoutBranch(name, ref.fullName, true);
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
