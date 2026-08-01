import * as vscode from 'vscode';
import type { RepositoryController } from '@git4vsc/repo-state';
import { pushResultMessage, updateResultMessage } from './operation-messages.js';
import { readGeneralSettings } from './settings.js';

export async function notifyUpdateResult(repository: RepositoryController, before: string | null, upstream: string, after = repository.snapshot.status?.head ?? null): Promise<void> {
  const conflicts = repository.snapshot.status?.changes.filter(change => change.conflict).length ?? 0;
  if (conflicts) {
    void vscode.window.showWarningMessage(`Update stopped with ${conflicts} unresolved ${conflicts === 1 ? 'conflict' : 'conflicts'}.`);
    await vscode.commands.executeCommand('git4vsc.resolveConflicts', repository);
    return;
  }
  if (!resultNotificationsEnabled()) return;
  if (!before || !after) {
    void vscode.window.showInformationMessage('Update completed.');
    return;
  }
  if (before === after) {
    void vscode.window.showInformationMessage('All files are up to date.');
    return;
  }
  const [files, commits] = await Promise.all([
    repository.git.changedFiles(repository.location, before, after),
    repository.git.commitCount(repository.location, `${before}..${upstream}`)
  ]);
  void vscode.window.showInformationMessage(updateResultMessage(files.length, commits), 'Open Commit Log').then(action => {
    if (action) void vscode.commands.executeCommand('git4vsc.openLog', repository);
  });
}

export function notifyPushResult(commits: number, target: string): void {
  if (!resultNotificationsEnabled()) return;
  void vscode.window.showInformationMessage(pushResultMessage(commits, target));
}

export function notifyFetchResult(remote?: string): void {
  if (!resultNotificationsEnabled()) return;
  void vscode.window.showInformationMessage(remote ? `Fetched ${remote} successfully.` : 'Fetch successful.');
}

export function notifyCommitResult(hash: string | null, subject: string): void {
  if (!resultNotificationsEnabled()) return;
  void vscode.window.showInformationMessage(hash ? `Committed ${hash.slice(0, 8)}: ${subject}` : `Committed: ${subject}`);
}

export function resultNotificationsEnabled(): boolean {
  return readGeneralSettings().showResultNotifications;
}
