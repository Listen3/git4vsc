import * as vscode from 'vscode';
import type { MergeConflict } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';
import { gitResourceUri } from './git-uri.js';

export class ConflictResolver implements vscode.Disposable {
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  private repository: RepositoryController | null = null;
  private activePath: string | null = null;
  private queue: string[] = [];

  constructor(private readonly refreshTree: () => void) {
    this.status.command = 'git4vsc.markConflictResolved';
  }

  dispose(): void { this.status.dispose(); }

  async start(repository: RepositoryController, preferredPath?: string): Promise<void> {
    const conflicts = await repository.git.conflicts(repository.location);
    if (!conflicts.length) {
      void vscode.window.showInformationMessage('Git4VSC: No unresolved conflicts remain.');
      return;
    }
    this.repository = repository;
    this.queue = conflicts.map(conflict => conflict.path);
    const conflict = conflicts.find(candidate => candidate.path === preferredPath) ?? conflicts[0]!;
    await vscode.commands.executeCommand('git4vsc.conflicts.focus');
    await this.open(repository, conflict.path);
  }

  async open(repository: RepositoryController, path: string): Promise<void> {
    const conflicts = await repository.git.conflicts(repository.location);
    const conflict = conflicts.find(candidate => candidate.path === path);
    if (!conflict) {
      void vscode.window.showInformationMessage(`Git4VSC: ${path} is already resolved.`);
      return;
    }
    if (this.repository !== repository) {
      this.repository = repository;
      this.queue = conflicts.map(candidate => candidate.path);
    }
    this.activePath = path;
    this.updateStatus(conflicts);

    const file = vscode.Uri.file(vscode.Uri.joinPath(vscode.Uri.file(repository.root), path).fsPath);
    const current = { uri: gitResourceUri(repository, path, ':2'), title: 'Current', detail: repository.snapshot.status?.branch ?? 'HEAD' };
    const incoming = { uri: gitResourceUri(repository, path, ':3'), title: 'Incoming' };
    await vscode.commands.executeCommand('_open.mergeEditor', {
      base: gitResourceUri(repository, path, ':1'),
      input1: incoming,
      input2: current,
      output: file
    });
  }

  async markResolved(repository = this.repository, path = this.activePath): Promise<void> {
    if (!repository || !path) return;
    const file = vscode.Uri.file(vscode.Uri.joinPath(vscode.Uri.file(repository.root), path).fsPath);
    const document = vscode.workspace.textDocuments.find(candidate => candidate.uri.fsPath === file.fsPath);
    if (document?.isDirty && !await document.save()) return;
    await repository.markConflictResolved([path]);
    await this.advance(repository, path);
  }

  async accept(repository: RepositoryController, paths: readonly string[], side: 'ours' | 'theirs'): Promise<void> {
    const label = side === 'ours' ? 'current' : 'incoming';
    const target = paths.length === 1 ? paths[0] : `${paths.length} files`;
    const confirmed = await vscode.window.showWarningMessage(`Accept ${label} version of ${target}?`, { modal: true }, `Accept ${label}`);
    if (!confirmed) return;
    await repository.acceptConflictSide(paths, side);
    await this.advance(repository, paths.at(-1) ?? '');
  }

  async restart(repository: RepositoryController, path: string): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(`Restart conflict resolution for ${path}?`, { modal: true, detail: 'The current merge result in this file will be replaced with conflict markers.' }, 'Restart');
    if (!confirmed) return;
    await repository.restoreConflict([path]);
    await this.open(repository, path);
  }

  async continue(repository: RepositoryController): Promise<void> {
    const conflicts = await repository.git.conflicts(repository.location);
    if (conflicts.length) {
      void vscode.window.showWarningMessage(`Resolve all ${conflicts.length} conflicts before continuing.`);
      await this.start(repository, conflicts[0]?.path);
      return;
    }
    await repository.continueOperation();
    this.finishSession();
    void vscode.window.showInformationMessage('Git operation completed.');
  }

  async abort(repository: RepositoryController): Promise<void> {
    const phase = repository.snapshot.status?.phase ?? 'operation';
    const confirmed = await vscode.window.showWarningMessage(`Abort the current ${phase} operation?`, { modal: true }, 'Abort');
    if (!confirmed) return;
    await repository.abortOperation();
    this.finishSession();
  }

  private async advance(repository: RepositoryController, resolvedPath: string): Promise<void> {
    this.refreshTree();
    const conflicts = await repository.git.conflicts(repository.location);
    if (!conflicts.length) {
      this.finishSession();
      const action = await vscode.window.showInformationMessage('All conflicts are resolved. Complete the Git operation?', 'Continue');
      if (action === 'Continue') await this.continue(repository);
      return;
    }
    const remaining = new Set(conflicts.map(conflict => conflict.path));
    const start = Math.max(0, this.queue.indexOf(resolvedPath) + 1);
    const next = [...this.queue.slice(start), ...this.queue.slice(0, start)].find(path => remaining.has(path)) ?? conflicts[0]!.path;
    await this.open(repository, next);
  }

  private updateStatus(conflicts: readonly MergeConflict[]): void {
    const index = Math.max(0, this.queue.indexOf(this.activePath ?? ''));
    this.status.text = `$(diff) Resolve conflict ${index + 1}/${this.queue.length}`;
    this.status.tooltip = `${this.activePath}\n${conflicts.length} unresolved · Click when the merge result is ready to stage and open the next file.`;
    this.status.show();
  }

  private finishSession(): void {
    this.repository = null;
    this.activePath = null;
    this.queue = [];
    this.status.hide();
    this.refreshTree();
  }
}
