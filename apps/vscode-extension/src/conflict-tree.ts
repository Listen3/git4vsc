import { basename, dirname } from 'node:path';
import * as vscode from 'vscode';
import type { MergeConflict } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';

export interface ConflictRepositoryNode {
  kind: 'repository';
  repository: RepositoryController;
}

export interface ConflictFileNode {
  kind: 'conflict';
  repository: RepositoryController;
  conflict: MergeConflict;
  path: string;
}

export type ConflictTreeNode = ConflictRepositoryNode | ConflictFileNode;

const kindLabels: Record<MergeConflict['kind'], string> = {
  'both-modified': 'both modified',
  'both-added': 'both added',
  'deleted-by-us': 'deleted by current',
  'deleted-by-them': 'deleted by incoming',
  'added-by-us': 'added by current',
  'added-by-them': 'added by incoming',
  'both-deleted': 'both deleted'
};

export class ConflictTree implements vscode.TreeDataProvider<ConflictTreeNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly repositories: () => readonly RepositoryController[]) {}

  refresh(): void { this.changed.fire(); }

  getTreeItem(node: ConflictTreeNode): vscode.TreeItem {
    if (node.kind === 'repository') {
      const status = node.repository.snapshot.status;
      const count = status?.changes.filter(change => change.conflict).length ?? 0;
      const item = new vscode.TreeItem(basename(node.repository.root), vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${status?.phase ?? 'operation'} · ${count} unresolved`;
      item.tooltip = node.repository.root;
      item.iconPath = new vscode.ThemeIcon('repo');
      item.contextValue = 'git4vsc.conflictRepository';
      return item;
    }
    const folder = dirname(node.path);
    const item = new vscode.TreeItem(basename(node.path), vscode.TreeItemCollapsibleState.None);
    item.description = `${folder === '.' ? '' : `${folder} · `}${kindLabels[node.conflict.kind]}`;
    item.tooltip = `${node.path}\nCurrent: ${node.conflict.ours ? 'modified' : 'deleted'}\nIncoming: ${node.conflict.theirs ? 'modified' : 'deleted'}`;
    item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    item.contextValue = 'git4vsc.conflict';
    item.command = { command: 'git4vsc.openConflict', title: 'Open Merge Editor', arguments: [node] };
    return item;
  }

  async getChildren(node?: ConflictTreeNode): Promise<ConflictTreeNode[]> {
    if (!node) {
      return this.repositories()
        .filter(repository => repository.snapshot.status?.changes.some(change => change.conflict))
        .map(repository => ({ kind: 'repository', repository }));
    }
    if (node.kind === 'conflict') return [];
    return (await node.repository.git.conflicts(node.repository.location)).map(conflict => ({
      kind: 'conflict', repository: node.repository, conflict, path: conflict.path
    }));
  }
}
