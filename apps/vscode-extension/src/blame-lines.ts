import type { GitBlameLine } from '@git4vsc/shared-types';

export interface BlameTextChange {
  startLine: number;
  endLine: number;
  text: string;
}

export function updateBlameLines(
  lines: readonly GitBlameLine[],
  changes: readonly BlameTextChange[],
  lineCount: number
): GitBlameLine[] {
  const lineDelta = changes.reduce((sum, change) => sum + lineBreaks(change.text) - (change.endLine - change.startLine), 0);
  const previousLineCount = lineCount - lineDelta;
  const byLine = new Map(lines.map(line => [line.line, line]));
  const result = Array.from({ length: previousLineCount }, (_, index) => byLine.get(index + 1) ?? uncommittedLine(index + 1));

  for (const change of [...changes].sort((left, right) => right.startLine - left.startLine || right.endLine - left.endLine)) {
    const replacementCount = lineBreaks(change.text) + 1;
    result.splice(
      change.startLine,
      change.endLine - change.startLine + 1,
      ...Array.from({ length: replacementCount }, (_, index) => uncommittedLine(change.startLine + index + 1))
    );
  }

  while (result.length < lineCount) result.push(uncommittedLine(result.length + 1));
  return result.slice(0, lineCount).map((line, index) => ({ ...line, line: index + 1 }));
}

function lineBreaks(text: string): number {
  return text.match(/\r\n|\r|\n/g)?.length ?? 0;
}

function uncommittedLine(line: number): GitBlameLine {
  return { hash: '0'.repeat(40), line, authorName: '', authorEmail: '', authorTime: 0, summary: 'Not committed' };
}
