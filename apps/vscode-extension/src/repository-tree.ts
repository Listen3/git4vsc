import { basename } from 'node:path';
import * as vscode from 'vscode';
import type { RepositoryController } from '@git4vsc/repo-state';

export class RepositoryTree implements vscode.TreeDataProvider<RepositoryController> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly repositories: () => readonly RepositoryController[]) {}

  refresh(): void { this.changed.fire(); }

  getTreeItem(repository: RepositoryController): vscode.TreeItem {
    const status = repository.snapshot.status;
    const item = new vscode.TreeItem(basename(repository.root), vscode.TreeItemCollapsibleState.None);
    item.description = status?.branch ?? status?.head?.slice(0, 8) ?? 'loading';
    item.tooltip = repository.root;
    item.iconPath = new vscode.ThemeIcon('repo');
    item.contextValue = 'git4vscRepository';
    item.command = { command: 'git4vsc.openLog', title: 'Open Commit Log', arguments: [repository] };
    return item;
  }

  getChildren(): RepositoryController[] {
    return [...this.repositories()];
  }
}
