export interface CommitColumnWidths {
  commit: number;
  author: number;
  date: number;
  hash: number;
}

export type CommitColumn = keyof CommitColumnWidths;

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
