import * as vscode from 'vscode';
import { clearAiApiKey, listAiModels, readAiSettings, saveAiSettings, testAiConnection, validAiSettings, type AiSettingsInput } from './ai-settings.js';
import { readGeneralSettings, resetGeneralSettings, updateGeneralSetting, validGeneralSetting, type GeneralSettingKey, type GeneralSettings } from './settings.js';

interface SettingsMessage {
  type: 'ready' | 'updateSetting' | 'resetSettings' | 'openNativeSettings' | 'saveAiSettings' | 'clearAiApiKey' | 'listAiModels' | 'testAiConnection';
  key?: unknown;
  value?: unknown;
  ai?: unknown;
}

type SettingsSection = 'general' | 'ai';

export class SettingsPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private section: SettingsSection = 'general';
  private readonly configurationSubscription: vscode.Disposable;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.configurationSubscription = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('git4vsc')) this.postSnapshot();
    });
  }

  show(section: SettingsSection = 'general'): void {
    this.section = section;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      void this.postSection();
      return;
    }
    const panel = vscode.window.createWebviewPanel('git4vsc.settings', 'Git4VSC Settings', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')]
    });
    this.panel = panel;
    panel.webview.html = this.html(panel.webview);
    panel.webview.onDidReceiveMessage(message => void this.handle(message as SettingsMessage));
    panel.onDidDispose(() => { this.panel = null; });
  }

  dispose(): void {
    this.configurationSubscription.dispose();
    this.panel?.dispose();
    this.panel = null;
  }

  private async handle(message: SettingsMessage): Promise<void> {
    if (message.type === 'ready') {
      await this.postSnapshot();
      return this.postSection();
    }
    if (message.type === 'openNativeSettings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:git4vsc.git4vsc');
      return;
    }
    if (message.type === 'clearAiApiKey') {
      await clearAiApiKey(this.context);
      await this.postAiResult('clear', true, 'API key removed.');
      return this.postSnapshot();
    }
    if ((message.type === 'saveAiSettings' || message.type === 'listAiModels' || message.type === 'testAiConnection') && validAiSettings(message.ai)) {
      await this.handleAi(message.type, message.ai);
      return;
    }
    if (message.type === 'resetSettings') await resetGeneralSettings();
    else if (message.type === 'updateSetting' && validGeneralSetting(message.key, message.value)) await updateGeneralSetting(message.key, message.value as GeneralSettings[GeneralSettingKey]);
    this.postSnapshot();
  }

  private async handleAi(type: 'saveAiSettings' | 'listAiModels' | 'testAiConnection', ai: AiSettingsInput): Promise<void> {
    const operation = type === 'saveAiSettings' ? 'save' : type === 'listAiModels' ? 'models' : 'test';
    try {
      if (type === 'saveAiSettings') {
        await saveAiSettings(this.context, ai);
        await this.postAiResult(operation, true, 'AI settings saved.');
        await this.postSnapshot();
      } else if (type === 'listAiModels') {
        const models = await listAiModels(this.context, ai);
        await this.panel?.webview.postMessage({ type: 'aiModels', models });
        await this.postAiResult(operation, true, models.length ? `${models.length} models loaded.` : 'No models returned.');
      } else {
        await testAiConnection(this.context, ai);
        await this.postAiResult(operation, true, 'Connection successful.');
      }
    } catch (error) {
      await this.postAiResult(operation, false, error instanceof Error ? error.message : String(error));
    }
  }

  private async postSnapshot(): Promise<void> {
    await this.panel?.webview.postMessage({ type: 'settingsSnapshot', general: readGeneralSettings(), ai: await readAiSettings(this.context) });
  }

  private async postSection(): Promise<void> {
    await this.panel?.webview.postMessage({ type: 'settingsSection', section: this.section });
  }

  private async postAiResult(operation: string, ok: boolean, message: string): Promise<void> {
    await this.panel?.webview.postMessage({ type: 'aiOperation', operation, ok, message });
  }

  private html(webview: vscode.Webview): string {
    const cacheKey = `${this.context.extension.packageJSON.version}-${Date.now()}`;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets', 'main.js')).with({ query: `v=${cacheKey}` });
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets', 'main.css')).with({ query: `v=${cacheKey}` });
    return `<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
<link rel="stylesheet" href="${style}"></head><body data-view="settings"><div id="root"></div><script type="module" src="${script}"></script></body></html>`;
  }
}
