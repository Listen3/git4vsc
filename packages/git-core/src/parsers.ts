import type { ChangeCode, CommitFileChange, CommitSummary, GitChange, GitRef } from '@git4vsc/shared-types';

export interface ParsedStatus {
  head: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
}

const changeCodes: Record<string, ChangeCode | undefined> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'unmerged'
};

function changeCode(code: string): ChangeCode | null {
  return code === '.' || code === ' ' ? null : changeCodes[code] ?? 'unmerged';
}

export function parsePorcelainV2(output: string): ParsedStatus {
  let head: string | null = null;
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const changes: GitChange[] = [];
  const records = output.split('\0');

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith('# branch.oid ')) {
      const value = record.slice(13);
      head = value === '(initial)' ? null : value;
      continue;
    }
    if (record.startsWith('# branch.head ')) {
      const value = record.slice(14);
      branch = value === '(detached)' ? null : value;
      continue;
    }
    if (record.startsWith('# branch.upstream ')) {
      upstream = record.slice(18);
      continue;
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(record);
      ahead = Number(match?.[1] ?? 0);
      behind = Number(match?.[2] ?? 0);
      continue;
    }
    if (record.startsWith('? ')) {
      changes.push({ path: record.slice(2), index: null, workingTree: 'untracked', conflict: false });
      continue;
    }
    if (record.startsWith('! ')) continue;

    const type = record[0];
    const parts = record.split(' ');
    const xy = parts[1] ?? '..';
    if (type === '1' || type === 'u') {
      const pathIndex = type === '1' ? 8 : 10;
      changes.push({
        path: parts.slice(pathIndex).join(' '),
        index: changeCode(xy[0] ?? '.'),
        workingTree: changeCode(xy[1] ?? '.'),
        conflict: type === 'u' || xy.includes('U')
      });
    } else if (type === '2') {
      const path = parts.slice(9).join(' ');
      const originalPath = records[index + 1] ?? '';
      index += 1;
      changes.push({
        path,
        originalPath,
        index: changeCode(xy[0] ?? '.'),
        workingTree: changeCode(xy[1] ?? '.'),
        conflict: false
      });
    }
  }

  return { head, branch, upstream, ahead, behind, changes };
}

export function parseRefs(output: string): GitRef[] {
  const refs: GitRef[] = [];
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const [fullName, hash, upstream] = line.split('\t');
    if (!fullName || !hash) continue;
    if (fullName.startsWith('refs/heads/')) {
      refs.push({ name: fullName.slice(11), fullName, hash, type: 'local-branch', ...(upstream ? { upstream } : {}) });
    } else if (fullName.startsWith('refs/remotes/')) {
      const name = fullName.slice(13);
      refs.push({ name, fullName, hash, type: 'remote-branch', remote: name.split('/')[0]! });
    } else if (fullName.startsWith('refs/tags/')) {
      refs.push({ name: fullName.slice(10), fullName, hash, type: 'tag' });
    }
  }
  return refs;
}

function decorationRef(value: string, hash: string): GitRef | null {
  const fullName = value.trim().replace(/^HEAD ->\s*/, '');
  if (fullName === 'HEAD') return { name: 'HEAD', fullName: 'HEAD', hash, type: 'head' };
  const ref = parseRefs(`${fullName}\t${hash}`)[0] ?? null;
  return ref?.type === 'remote-branch' && ref.name.endsWith('/HEAD') ? null : ref;
}

export function parseLog(output: string): CommitSummary[] {
  const fields = output.split('\0');
  const commits: CommitSummary[] = [];
  const width = 8;
  for (let index = 0; index + width - 1 < fields.length; index += width) {
    const hash = fields[index];
    if (!hash) break;
    const decorations = fields[index + 7] ?? '';
    commits.push({
      hash,
      parents: (fields[index + 1] ?? '').split(' ').filter(Boolean),
      authorName: fields[index + 2] ?? '',
      authorEmail: fields[index + 3] ?? '',
      authorTime: Number(fields[index + 4] ?? 0),
      committerTime: Number(fields[index + 5] ?? 0),
      subject: fields[index + 6] ?? '',
      refs: decorations.split(',').map(value => decorationRef(value, hash)).filter((ref): ref is GitRef => ref !== null)
    });
  }
  return commits;
}

const fileStatuses: Record<string, CommitFileChange['status'] | undefined> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
  U: 'unmerged'
};

export function parseNameStatus(output: string): CommitFileChange[] {
  const fields = output.split('\0');
  const changes: CommitFileChange[] = [];
  for (let index = 0; index < fields.length;) {
    const code = fields[index++];
    if (!code) continue;
    const kind = code[0] ?? 'U';
    const status = fileStatuses[kind] ?? 'unmerged';
    if (kind === 'R' || kind === 'C') {
      const originalPath = fields[index++] ?? '';
      const path = fields[index++] ?? '';
      if (path) changes.push({ path, originalPath, status });
    } else {
      const path = fields[index++] ?? '';
      if (path) changes.push({ path, status });
    }
  }
  return changes;
}
