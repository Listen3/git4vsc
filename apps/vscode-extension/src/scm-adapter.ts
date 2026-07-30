import * as vscode from 'vscode';
import type { GitChange } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';

export interface GitResourceState extends vscode.SourceControlResourceState {
  readonly repository: RepositoryController;
  readonly path: string;
}

function virtualUri(repository: RepositoryController, path: string, revision: 'HEAD' | 'index'): vscode.Uri {
  return vscode.Uri.from({
    scheme: 'git4vsc',
    path: `/${path.replaceAll('\\', '/')}`,
    query: encodeURIComponent(JSON.stringify({ root: repository.root, path, revision }))
  });
}

function resource(
  repository: RepositoryController,
  change: GitChange,
  side: 'staged' | 'working' | 'untracked'
): GitResourceState {
  const file = vscode.Uri.file(vscode.Uri.joinPath(vscode.Uri.file(repository.root), change.path).fsPath);
  const left = side === 'staged' ? virtualUri(repository, change.path, 'HEAD') : virtualUri(repository, change.path, 'index');
  const right = side === 'staged' ? virtualUri(repository, change.path, 'index') : file;
  return {
    repository,
    path: change.path,
    resourceUri: file,
    command: {
      command: 'vscode.diff',
      title: 'Open Change',
      arguments: [left, right, `${change.path} (${side === 'staged' ? 'Index' : 'Working Tree'})`]
    },
    decorations: {
      tooltip: change.conflict ? 'Merge conflict' : change.index ?? change.workingTree ?? 'changed',
      strikeThrough: change.index === 'deleted' || change.workingTree === 'deleted'
    }
  };
}

export class ScmRepositoryAdapter implements vscode.Disposable {
  readonly sourceControl: vscode.SourceControl;
  private readonly staged: vscode.SourceControlResourceGroup;
  private readonly working: vscode.SourceControlResourceGroup;
  private readonly untracked: vscode.SourceControlResourceGroup;
  private readonly unsubscribe: () => void;

  constructor(readonly repository: RepositoryController) {
    const rootUri = vscode.Uri.file(repository.root);
    this.sourceControl = vscode.scm.createSourceControl('git4vsc', `Git4VSC: ${vscode.workspace.asRelativePath(rootUri)}`, rootUri);
    this.sourceControl.acceptInputCommand = { command: 'git4vsc.commit', title: 'Commit' };
    this.sourceControl.inputBox.placeholder = 'Message (Ctrl+Enter to commit staged changes)';
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
    this.sourceControl.statusBarCommands = [{
      command: 'git4vsc.toggleLog',
      title: status.branch ?? status.head?.slice(0, 8) ?? 'HEAD',
      tooltip: `Toggle Git Log · ${status.phase}${status.upstream ? ` · ↑${status.ahead} ↓${status.behind}` : ''}`,
      arguments: [this.repository]
    }];
    this.staged.resourceStates = status.changes.filter(change => change.index !== null).map(change => resource(this.repository, change, 'staged'));
    this.working.resourceStates = status.changes.filter(change => change.workingTree !== null && change.workingTree !== 'untracked').map(change => resource(this.repository, change, 'working'));
    this.untracked.resourceStates = status.changes.filter(change => change.workingTree === 'untracked').map(change => resource(this.repository, change, 'untracked'));
  }

  dispose(): void {
    this.unsubscribe();
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
