import { isAbsolute, relative } from 'node:path';
import * as vscode from 'vscode';
import type { GitBlameLine } from '@git4vsc/shared-types';
import type { RepositoryController } from '@git4vsc/repo-state';

export class BlameAnnotations implements vscode.Disposable {
  private readonly enabled = new Set<string>();
  private readonly cache = new Map<string, GitBlameLine[]>();
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    before: {
      backgroundColor: new vscode.ThemeColor('editorGutter.background'),
      color: new vscode.ThemeColor('git4vsc.blame.foreground'),
      width: 'calc(17ch + 8px)',
      height: '100%',
      margin: '0 7px -1px 0',
      textDecoration: css({
        display: 'inline-flex',
        'align-items': 'center',
        'box-sizing': 'border-box',
        padding: '0 4px',
        'border-right': '1px solid rgba(127, 127, 127, .28)',
        'font-size': '.86em',
        'font-variant-numeric': 'tabular-nums',
        'white-space': 'pre'
      })
    }
  });
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly repositories: () => readonly RepositoryController[],
    private readonly openRepository: (path: string) => Promise<RepositoryController>
  ) {
    this.subscriptions = [
      vscode.window.onDidChangeActiveTextEditor(() => this.updateContext()),
      vscode.window.onDidChangeVisibleTextEditors(editors => {
        for (const editor of editors) this.applyCached(editor);
      }),
      vscode.workspace.onDidSaveTextDocument(document => {
        if (this.enabled.has(document.uri.toString())) void this.render(document);
      })
    ];
    this.updateContext();
  }

  async toggle(uri?: vscode.Uri): Promise<void> {
    const editor = this.editor(uri);
    if (!editor || editor.document.uri.scheme !== 'file') return;
    const key = editor.document.uri.toString();
    if (this.enabled.delete(key)) {
      this.cache.delete(key);
      this.clear(key);
      this.updateContext();
      return;
    }
    this.enabled.add(key);
    this.updateContext();
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Loading Git blame…' }, () => this.render(editor.document));
  }

  dispose(): void {
    this.decoration.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  private async render(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.toString();
    try {
      const repository = this.repository(document.uri.fsPath) ?? await this.openRepository(document.uri.fsPath);
      const path = relative(repository.root, document.uri.fsPath).replaceAll('\\', '/');
      const lines = await repository.git.blame(repository.location, path);
      this.cache.set(key, lines);
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === key) this.apply(editor, lines);
      }
    } catch {
      this.enabled.delete(key);
      this.cache.delete(key);
      this.clear(key);
      this.updateContext();
      void vscode.window.showWarningMessage('Git blame is unavailable for this file.');
    }
  }

  private applyCached(editor: vscode.TextEditor): void {
    const key = editor.document.uri.toString();
    const lines = this.cache.get(key);
    if (this.enabled.has(key) && lines) this.apply(editor, lines);
  }

  private apply(editor: vscode.TextEditor, lines: readonly GitBlameLine[]): void {
    const backgrounds = blameBackgrounds(lines);
    const options = lines.filter(line => line.line <= editor.document.lineCount).map(line => {
      const local = /^0+$/.test(line.hash);
      const hover = new vscode.MarkdownString();
      hover.appendText(`${line.authorName} <${line.authorEmail}>\n${line.summary}\n${local ? 'Not committed' : line.hash}\n${formatExactTime(line.authorTime)}`);
      return {
        range: new vscode.Range(line.line - 1, 0, line.line - 1, 0),
        hoverMessage: hover,
        renderOptions: {
          before: {
            contentText: local ? ' '.repeat(17) : `${fit(formatBlameDay(line.authorTime), 10)} ${fit(line.authorName, 6)}`,
            backgroundColor: local
              ? new vscode.ThemeColor('editorGutter.background')
              : backgrounds.get(line.authorTime) ?? new vscode.ThemeColor('editorGutter.background')
          }
        }
      } satisfies vscode.DecorationOptions;
    });
    editor.setDecorations(this.decoration, options);
  }

  private clear(key: string): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === key) editor.setDecorations(this.decoration, []);
    }
  }

  private editor(uri?: vscode.Uri): vscode.TextEditor | undefined {
    if (!uri) return vscode.window.activeTextEditor;
    return vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString()) ?? vscode.window.activeTextEditor;
  }

  private repository(file: string): RepositoryController | undefined {
    return this.repositories()
      .filter(repository => {
        const path = relative(repository.root, file);
        return path !== '' && !path.startsWith('..') && !isAbsolute(path);
      })
      .sort((left, right) => right.root.length - left.root.length)[0];
  }

  private updateContext(): void {
    const key = vscode.window.activeTextEditor?.document.uri.toString();
    void vscode.commands.executeCommand('setContext', 'git4vsc.blameVisible', Boolean(key && this.enabled.has(key)));
  }
}

function fit(value: string, length: number): string {
  const characters = [...value];
  const widths = characters.map(character => character.codePointAt(0)! > 0xff ? 2 : 1);
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= length) return value + ' '.repeat(length - total);
  let result = '';
  let width = 0;
  for (let index = 0; index < characters.length; index += 1) {
    if (width + widths[index]! > length - 1) break;
    result += characters[index];
    width += widths[index]!;
  }
  return `${result}…${' '.repeat(length - width - 1)}`;
}

function blameBackgrounds(lines: readonly GitBlameLine[]): Map<number, vscode.ThemeColor> {
  const timestamps = [...new Set(lines.filter(line => !/^0+$/.test(line.hash)).map(line => line.authorTime))].sort((left, right) => right - left);
  const tones = ['newest', 'newer', 'middle', 'older', 'oldest'];
  return new Map(timestamps.map((timestamp, index) => {
    const tone = tones[Math.round(index * (tones.length - 1) / Math.max(1, timestamps.length - 1))]!;
    return [timestamp, new vscode.ThemeColor(`git4vsc.blame.${tone}Background`)];
  }));
}

function formatBlameDay(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const days = calendarDay(now) - calendarDay(date);
  if (days === 0 || days === 1) {
    const label = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-days, 'day');
    return label.charAt(0).toLocaleUpperCase() + label.slice(1);
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function formatExactTime(timestamp: number): string {
  return timestamp ? new Date(timestamp * 1000).toLocaleString() : 'Not committed';
}

function calendarDay(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function css(styles: Record<string, string>): string {
  return `none;${Object.entries(styles).map(([property, value]) => `${property}:${value}`).join(';')};`;
}
