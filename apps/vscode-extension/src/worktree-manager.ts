import { basename, resolve } from 'node:path';
import * as vscode from 'vscode';
import type { GitRef, GitWorktree } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';
import { worktreePath } from './worktree-path.js';

export interface WorktreeItem {
  repository: RepositoryController;
  worktree: GitWorktree;
  current: boolean;
  open: boolean;
}

export class WorktreeManager implements vscode.TreeDataProvider<WorktreeItem>, vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<void>();
  private repository: RepositoryController | null = null;
  readonly onDidChangeTreeData = this.changes.event;

  constructor(private readonly defaultRepository: () => RepositoryController | undefined) {}

  select(repository: RepositoryController | undefined): void {
    if (!repository || this.repository === repository) return;
    this.repository = repository;
    this.refresh();
  }

  refresh(): void {
    this.changes.fire();
  }

  dispose(): void {
    this.changes.dispose();
  }

  getTreeItem(item: WorktreeItem): vscode.TreeItem {
    const { worktree } = item;
    const state = worktree.main ? 'Main' : item.current ? 'Current' : worktree.locked ? 'Locked' : worktree.prunable ? 'Prunable' : '';
    const revision = worktree.branch ?? (worktree.head ? worktree.head.slice(0, 8) : worktree.bare ? 'Bare' : 'Unknown');
    const treeItem = new vscode.TreeItem(basename(worktree.path) || worktree.path, vscode.TreeItemCollapsibleState.None);
    treeItem.description = [revision, state].filter(Boolean).join(' · ');
    treeItem.tooltip = new vscode.MarkdownString([
      `**${worktree.branch ?? (worktree.detached ? 'Detached HEAD' : 'Worktree')}**`,
      worktree.path,
      worktree.head ? `Commit: \`${worktree.head}\`` : '',
      worktree.lockReason ? `Locked: ${worktree.lockReason}` : '',
      worktree.pruneReason ? `Prunable: ${worktree.pruneReason}` : ''
    ].filter(Boolean).join('\n\n'));
    treeItem.iconPath = new vscode.ThemeIcon(worktree.main ? 'repo' : worktree.prunable ? 'warning' : worktree.locked ? 'lock' : 'git-branch');
    treeItem.contextValue = item.open
      ? 'git4vsc.worktree.open'
      : worktree.main ? 'git4vsc.worktree.main'
        : worktree.prunable ? 'git4vsc.worktree.prunable'
          : worktree.locked ? 'git4vsc.worktree.locked'
            : 'git4vsc.worktree.linked';
    return treeItem;
  }

  async getChildren(): Promise<WorktreeItem[]> {
    const repository = this.repository ?? this.defaultRepository();
    if (!repository) return [];
    return repository.snapshot.worktrees.map(worktree => ({
      repository,
      worktree,
      current: samePath(worktree.path, repository.root),
      open: Boolean(vscode.workspace.getWorkspaceFolder(vscode.Uri.file(worktree.path)))
    }));
  }

  async create(): Promise<void> {
    const repository = this.repository ?? this.defaultRepository();
    const status = repository?.snapshot.status;
    if (!repository || !status) return;
    const worktrees = repository.snapshot.worktrees;
    const mode = await vscode.window.showQuickPick([
      { id: 'branch', label: '$(git-branch-create) New Branch', description: 'Create a branch in the new worktree' },
      { id: 'existing', label: '$(git-branch) Existing Branch', description: 'Check out an unused local branch' },
      { id: 'detached', label: '$(debug-disconnect) Detached HEAD', description: 'Open a revision without a branch' }
    ], { title: 'New Worktree', placeHolder: 'Choose how to create the worktree' });
    if (!mode) return;

    let ref: string;
    let newBranch: string | undefined;
    let directoryName: string;
    if (mode.id === 'existing') {
      const occupied = new Set(worktrees.map(worktree => worktree.branch).filter(Boolean));
      const selected = await pickRef(status.refs.filter(candidate => candidate.type === 'local-branch' && !occupied.has(candidate.name)), 'Select an unused local branch');
      if (!selected) return;
      ref = selected.name;
      directoryName = selected.name;
    } else {
      const selected = await pickRef([{ name: 'HEAD', fullName: 'HEAD', hash: status.head ?? '', type: 'head' }, ...status.refs], 'Select the source revision');
      if (!selected) return;
      ref = selected.fullName;
      if (mode.id === 'branch') {
        newBranch = (await vscode.window.showInputBox({
          title: 'New Worktree Branch',
          prompt: `Create a branch from ${selected.name}`,
          validateInput: value => !value.trim() ? 'Enter a branch name' : status.refs.some(candidate => candidate.name === value.trim()) ? 'Branch already exists' : undefined
        }))?.trim();
        if (!newBranch) return;
      }
      directoryName = newBranch ?? selected.name;
    }
    const target = await vscode.window.showOpenDialog({ title: 'Select Worktree Location', canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Create Worktree Here' });
    const selectedPath = target?.[0]?.fsPath;
    if (!selectedPath) return;
    let path: string;
    try {
      path = await worktreePath(selectedPath, directoryName);
    } catch (error) {
      void vscode.window.showWarningMessage(message(error));
      return;
    }
    await repository.addWorktree(path, ref, newBranch, mode.id === 'detached');
    this.refresh();
    await vscode.commands.executeCommand('git4vsc.openWorktrees', repository);
    const open = await vscode.window.showInformationMessage(`Worktree created at ${path}.`, 'Open Worktree');
    if (open) await this.openPath(path);
  }

  async open(item: WorktreeItem): Promise<void> {
    if (item.worktree.prunable) return;
    await this.openPath(item.worktree.path);
  }

  async remove(item: WorktreeItem): Promise<void> {
    if (item.worktree.main || item.open || item.worktree.prunable || item.worktree.locked) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Delete worktree ${basename(item.worktree.path)}?`,
      { modal: true, detail: `This deletes the directory ${item.worktree.path} and its Git worktree metadata. The branch will not be deleted.` },
      'Delete Worktree'
    );
    if (!confirmed) return;
    try {
      await item.repository.removeWorktree(item.worktree.path);
    } catch (error) {
      const force = await vscode.window.showWarningMessage(
        'The worktree could not be deleted safely.',
        { modal: true, detail: `${message(error)}\n\nForce Remove permanently deletes modified and untracked files in this worktree.` },
        'Force Remove'
      );
      if (!force) return;
      await item.repository.removeWorktree(item.worktree.path, true);
    }
    this.refresh();
    void vscode.window.showInformationMessage(`Worktree deleted: ${item.worktree.path}`);
  }

  async prune(): Promise<void> {
    const repository = this.repository ?? this.defaultRepository();
    if (!repository) return;
    const worktrees = repository.snapshot.worktrees;
    const count = worktrees.filter(worktree => worktree.prunable).length;
    if (!count) {
      void vscode.window.showInformationMessage('No prunable worktrees found.');
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(`Prune ${count} missing worktree record${count === 1 ? '' : 's'}?`, { modal: true }, 'Prune');
    if (!confirmed) return;
    await repository.pruneWorktrees();
    this.refresh();
    void vscode.window.showInformationMessage(`Pruned ${count} worktree record${count === 1 ? '' : 's'}.`);
  }

  async lock(item: WorktreeItem): Promise<void> {
    if (item.worktree.main || item.open || item.worktree.locked || item.worktree.prunable) return;
    const reason = await vscode.window.showInputBox({ title: `Lock ${basename(item.worktree.path)}`, prompt: 'Optional reason; press Enter to lock without one' });
    if (reason === undefined) return;
    await item.repository.lockWorktree(item.worktree.path, reason.trim() || undefined);
    this.refresh();
  }

  async unlock(item: WorktreeItem): Promise<void> {
    if (!item.worktree.locked) return;
    await item.repository.unlockWorktree(item.worktree.path);
    this.refresh();
  }

  copyPath(item: WorktreeItem): Thenable<void> {
    return vscode.env.clipboard.writeText(item.worktree.path);
  }

  private openPath(path: string): Thenable<unknown> {
    return vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), true);
  }
}

async function pickRef(refs: readonly GitRef[], placeHolder: string): Promise<GitRef | undefined> {
  const items = refs.map(ref => ({ label: ref.name, description: ref.type === 'remote-branch' ? 'Remote' : ref.type === 'tag' ? 'Tag' : ref.type === 'head' ? 'Current revision' : 'Local', ref }));
  return (await vscode.window.showQuickPick(items, { title: 'New Worktree', placeHolder, matchOnDescription: true }))?.ref;
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? resolve(left).toLowerCase() === resolve(right).toLowerCase() : resolve(left) === resolve(right);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
