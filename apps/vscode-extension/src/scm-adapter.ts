import * as vscode from 'vscode';
import type { GitChange } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';
import { gitResourceUri } from './git-uri.js';
import { statusBarPresentation } from './repository-status.js';

export interface GitResourceState extends vscode.SourceControlResourceState {
  readonly repository: RepositoryController;
  readonly path: string;
}

function resource(
  repository: RepositoryController,
  change: GitChange,
  side: 'merge' | 'staged' | 'working' | 'untracked'
): GitResourceState {
  const file = vscode.Uri.file(vscode.Uri.joinPath(vscode.Uri.file(repository.root), change.path).fsPath);
  const left = side === 'staged' ? gitResourceUri(repository, change.path, 'HEAD') : gitResourceUri(repository, change.path, 'index');
  const right = side === 'staged' ? gitResourceUri(repository, change.path, 'index') : file;
  return {
    repository,
    path: change.path,
    resourceUri: file,
    contextValue: side === 'merge' ? 'git4vsc.conflict' : `git4vsc.${side}`,
    command: side === 'merge'
      ? { command: 'git4vsc.openConflict', title: 'Open Merge Editor', arguments: [{ repository, path: change.path }] }
      : { command: 'vscode.diff', title: 'Open Change', arguments: [left, right, `${change.path} (${side === 'staged' ? 'Index' : 'Working Tree'})`] },
    decorations: {
      tooltip: change.conflict ? 'Merge conflict' : change.index ?? change.workingTree ?? 'changed',
      strikeThrough: change.index === 'deleted' || change.workingTree === 'deleted',
      ...(side === 'merge' ? { iconPath: new vscode.ThemeIcon('warning'), faded: false } : {})
    }
  };
}

export class ScmRepositoryAdapter implements vscode.Disposable {
  readonly sourceControl: vscode.SourceControl;
  private readonly logStatus: vscode.StatusBarItem;
  private readonly branchStatus: vscode.StatusBarItem;
  private readonly merge: vscode.SourceControlResourceGroup;
  private readonly staged: vscode.SourceControlResourceGroup;
  private readonly working: vscode.SourceControlResourceGroup;
  private readonly untracked: vscode.SourceControlResourceGroup;
  private readonly unsubscribe: () => void;

  constructor(readonly repository: RepositoryController) {
    const rootUri = vscode.Uri.file(repository.root);
    this.sourceControl = vscode.scm.createSourceControl('git4vsc', `Git4VSC: ${vscode.workspace.asRelativePath(rootUri)}`, rootUri);
    this.logStatus = vscode.window.createStatusBarItem('git4vsc.commitLogStatus', vscode.StatusBarAlignment.Left, 101);
    this.logStatus.name = 'Git4VSC Commit Log';
    this.logStatus.text = '$(git-commit)';
    this.logStatus.tooltip = 'Toggle Commit Log';
    this.logStatus.command = { command: 'git4vsc.toggleLog', title: 'Toggle Commit Log', arguments: [repository] };
    this.logStatus.show();
    this.branchStatus = vscode.window.createStatusBarItem('git4vsc.branchStatus', vscode.StatusBarAlignment.Left, 100);
    this.branchStatus.name = 'Git4VSC Branch';
    this.branchStatus.command = { command: 'git4vsc.showBranchMenu', title: 'Repository and Branch Actions', arguments: [repository] };
    this.branchStatus.show();
    this.sourceControl.acceptInputCommand = { command: 'git4vsc.commit', title: 'Commit' };
    this.sourceControl.inputBox.placeholder = 'Message (Ctrl+Enter to commit staged changes)';
    this.merge = this.sourceControl.createResourceGroup('merge', 'Merge Changes');
    this.staged = this.sourceControl.createResourceGroup('staged', 'Staged Changes');
    this.working = this.sourceControl.createResourceGroup('working', 'Changes');
    this.untracked = this.sourceControl.createResourceGroup('untracked', 'Untracked Files');
    this.unsubscribe = repository.onDidChange(() => this.update());
    this.update();
  }

  update(): void {
    const status = this.repository.snapshot.status;
    if (!status) return;
    this.sourceControl.inputBox.enabled = this.repository.snapshot.operation === null;
    this.sourceControl.count = status.changes.length;
    const statusBar = statusBarPresentation(this.repository.snapshot);
    this.sourceControl.statusBarCommands = [];
    this.branchStatus.text = statusBar.title;
    this.branchStatus.tooltip = statusBar.tooltip;
    this.merge.resourceStates = status.changes.filter(change => change.conflict).map(change => resource(this.repository, change, 'merge'));
    this.staged.resourceStates = status.changes.filter(change => !change.conflict && change.index !== null).map(change => resource(this.repository, change, 'staged'));
    this.working.resourceStates = status.changes.filter(change => !change.conflict && change.workingTree !== null && change.workingTree !== 'untracked').map(change => resource(this.repository, change, 'working'));
    this.untracked.resourceStates = status.changes.filter(change => change.workingTree === 'untracked').map(change => resource(this.repository, change, 'untracked'));
  }

  dispose(): void {
    this.unsubscribe();
    this.logStatus.dispose();
    this.branchStatus.dispose();
    this.sourceControl.dispose();
  }
}

export class GitContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly repositories: () => readonly RepositoryController[]) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const request = JSON.parse(decodeURIComponent(uri.query)) as { root: string; path: string; revision: string | null };
    const repository = this.repositories().find(candidate => candidate.root === request.root);
    if (!repository || request.revision === null) return '';
    try {
      return await repository.git.show(repository.location, request.path, request.revision);
    } catch {
      return '';
    }
  }
}
