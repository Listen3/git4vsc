import * as vscode from 'vscode';
import type { RepositoryController } from '@git4vsc/repo-state';

export class LogPanel {
  private static readonly panels = new Map<string, LogPanel>();
  private readonly unsubscribe: () => void;

  static show(context: vscode.ExtensionContext, repository: RepositoryController): void {
    const existing = this.panels.get(repository.root);
    if (existing) {
      existing.panel.reveal();
      existing.postSnapshot();
      return;
    }
    const panel = vscode.window.createWebviewPanel('git4vsc.log', `Git Log — ${repository.snapshot.status?.branch ?? 'HEAD'}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')]
    });
    this.panels.set(repository.root, new LogPanel(context, repository, panel));
  }

  private constructor(
    context: vscode.ExtensionContext,
    private readonly repository: RepositoryController,
    readonly panel: vscode.WebviewPanel
  ) {
    panel.webview.html = this.html(context, panel.webview);
    this.unsubscribe = repository.onDidChange(() => this.postSnapshot());
    panel.webview.onDidReceiveMessage(async message => {
      if (message.type === 'ready') this.postSnapshot();
      if (message.type === 'refresh') {
        repository.invalidate('status', 'log', 'refs');
        await repository.refresh();
      }
      if (message.type === 'loadMore') await repository.loadMore();
    });
    panel.onDidDispose(() => {
      this.unsubscribe();
      LogPanel.panels.delete(repository.root);
    });
  }

  private postSnapshot(): void {
    const snapshot = this.repository.snapshot;
    void this.panel.webview.postMessage({
      type: 'snapshot',
      state: {
        status: snapshot.status,
        commits: snapshot.commits,
        loading: snapshot.loading.size > 0 || snapshot.operation !== null,
        error: snapshot.error
      }
    });
  }

  private html(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'assets', 'main.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'assets', 'main.css'));
    return `<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
<link rel="stylesheet" href="${style}"></head><body><div id="root"></div><script type="module" src="${script}"></script></body></html>`;
  }
}

