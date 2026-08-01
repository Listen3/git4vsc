import { basename } from 'node:path';
import * as vscode from 'vscode';
import type { RepositoryController } from '@git4vsc/repo-state';
import type { PushPreviewDialogRequest } from '@git4vsc/shared-types';
import { notifyPushResult, resultNotificationsEnabled } from './operation-notifications.js';

interface PushPreviewState {
  repository: RepositoryController;
  branch: string;
  remote: string;
  dialog: PushPreviewDialogRequest;
}

export class PushPreviewPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private state: PushPreviewState | null = null;
  private nextDialogId = 1;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async show(repository: RepositoryController, branch: string, remote: string, upstream?: string): Promise<void> {
    const commits = await repository.git.outgoingCommits(repository.location, branch, remote, upstream);
    if (!commits.length) {
      if (resultNotificationsEnabled()) void vscode.window.showInformationMessage('Everything is up to date.');
      return;
    }

    const preview = await Promise.all(commits.map(async commit => ({
      commit,
      files: (await repository.git.commitDetails(repository.location, commit.hash)).files
    })));
    this.state = {
      repository,
      branch,
      remote,
      dialog: {
        id: this.nextDialogId++,
        kind: 'push-preview',
        title: `Push Commits to ${basename(repository.root)}`,
        source: branch,
        target: `${remote}/${branch}`,
        commits: preview
      }
    };

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      await this.postPreview();
      return;
    }

    const panel = vscode.window.createWebviewPanel('git4vsc.pushPreview', 'Git4VSC Push Preview', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')]
    });
    this.panel = panel;
    panel.webview.html = this.html(panel.webview);
    panel.webview.onDidReceiveMessage(message => void this.handleMessage(message));
    panel.onDidDispose(() => {
      this.panel = null;
      this.state = null;
    });
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
    this.state = null;
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    const request = message as Record<string, unknown>;
    if (request.type === 'ready') {
      await this.postPreview();
      return;
    }
    if (request.type !== 'pushPreviewResult') return;

    const state = this.state;
    this.panel?.dispose();
    if (request.value !== 'push' || !state) return;
    try {
      await state.repository.pushBranch(state.branch, state.remote);
      notifyPushResult(state.dialog.commits.length, state.dialog.target);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private async postPreview(): Promise<void> {
    if (this.panel && this.state) await this.panel.webview.postMessage({ type: 'pushPreview', dialog: this.state.dialog });
  }

  private html(webview: vscode.Webview): string {
    const cacheKey = `${this.context.extension.packageJSON.version}-${Date.now()}`;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets', 'main.js')).with({ query: `v=${cacheKey}` });
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets', 'main.css')).with({ query: `v=${cacheKey}` });
    return `<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
<link rel="stylesheet" href="${style}"></head><body data-view="push-preview"><div id="root"></div><script type="module" src="${script}"></script></body></html>`;
  }
}
