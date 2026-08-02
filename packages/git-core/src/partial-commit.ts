import type { GitDiffHunk } from '@git4vsc/shared-types';

interface ParsedHunk extends GitDiffHunk {
  text: string;
}

export interface ParsedFilePatch {
  header: string;
  hunks: ParsedHunk[];
  binary: boolean;
}

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseFilePatch(patch: string): ParsedFilePatch {
  const lines = patch.split('\n');
  const firstHunk = lines.findIndex(line => line.startsWith('@@ '));
  if (firstHunk < 0) return { header: patch, hunks: [], binary: /(?:^|\n)(?:GIT binary patch|Binary files )/.test(patch) };

  const header = `${lines.slice(0, firstHunk).join('\n')}\n`;
  const hunks: ParsedHunk[] = [];
  let start = firstHunk;
  while (start < lines.length) {
    if (!lines[start]!.startsWith('@@ ')) { start += 1; continue; }
    let end = start + 1;
    while (end < lines.length && !lines[end]!.startsWith('@@ ')) end += 1;
    const text = `${lines.slice(start, end).join('\n')}${end < lines.length || patch.endsWith('\n') ? '\n' : ''}`;
    const match = hunkHeader.exec(lines[start]!);
    if (match) {
      const body = lines.slice(start + 1, end);
      hunks.push({
        id: `${match[1]}:${match[2] ?? '1'}:${match[3]}:${match[4] ?? '1'}:${hunks.length}`,
        header: `${lines[start]}`,
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? 1),
        additions: body.filter(line => line.startsWith('+') && !line.startsWith('+++')).length,
        deletions: body.filter(line => line.startsWith('-') && !line.startsWith('---')).length,
        text
      });
    }
    start = end;
  }
  return { header, hunks, binary: false };
}

export function selectPatchHunks(patch: string, selectedIds: ReadonlySet<string>): string {
  const parsed = parseFilePatch(patch);
  const hunks = parsed.hunks.filter(hunk => selectedIds.has(hunk.id));
  return hunks.length ? `${parsed.header}${hunks.map(hunk => hunk.text).join('')}` : '';
}
