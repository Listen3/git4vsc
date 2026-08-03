export interface CommitColumnWidths {
  commit: number;
  author: number;
  date: number;
  hash: number;
}

export type CommitColumn = keyof CommitColumnWidths;
export type CommitDetailColumn = Exclude<CommitColumn, 'commit'>;

export interface CommitColumnVisibility {
  author: boolean;
  date: boolean;
  hash: boolean;
}

export const defaultCommitColumnWidths: CommitColumnWidths = {
  commit: 440,
  author: 110,
  date: 132,
  hash: 64
};

export const defaultCommitColumnVisibility: CommitColumnVisibility = {
  author: true,
  date: true,
  hash: true
};

const limits: Record<CommitColumn, readonly [number, number]> = {
  commit: [180, 900],
  author: [70, 320],
  date: [95, 260],
  hash: [56, 160]
};

export function normalizeCommitColumnWidths(value?: Partial<CommitColumnWidths>): CommitColumnWidths {
  return Object.fromEntries(Object.entries(defaultCommitColumnWidths).map(([key, fallback]) => {
    const column = key as CommitColumn;
    const [min, max] = limits[column];
    const width = value?.[column] ?? fallback;
    return [column, Math.round(Math.max(min, Math.min(max, width)))];
  })) as unknown as CommitColumnWidths;
}

export function normalizeCommitColumnVisibility(value?: Partial<CommitColumnVisibility>): CommitColumnVisibility {
  return {
    author: value?.author ?? true,
    date: value?.date ?? true,
    hash: value?.hash ?? true
  };
}

export function resizeCommitDetailColumn(widths: CommitColumnWidths, column: CommitDetailColumn, offset: number, commitMinimum = limits.commit[0]): CommitColumnWidths {
  const current = normalizeCommitColumnWidths(widths);
  const [columnMin, columnMax] = limits[column];
  const commitMin = Math.min(limits.commit[1], Math.max(limits.commit[0], commitMinimum));
  const minOffset = Math.max(commitMin - current.commit, current[column] - columnMax);
  const maxOffset = Math.min(limits.commit[1] - current.commit, current[column] - columnMin);
  const applied = Math.round(Math.max(minOffset, Math.min(maxOffset, offset)));
  return { ...current, commit: current.commit + applied, [column]: current[column] - applied };
}
