import type { CommitSummary } from '@git4vsc/shared-types';

export interface GraphConnection {
  fromLane: number;
  toLane: number;
  toHash: string;
  kind: 'through' | 'parent';
  parentIndex?: number;
}

export interface GraphRow {
  row: number;
  commitHash: string;
  nodeLane: number;
  isHead: boolean;
  laneCount: number;
  lanesBefore: readonly string[];
  lanesAfter: readonly string[];
  connections: readonly GraphConnection[];
}

export interface PermanentGraph {
  rows: readonly GraphRow[];
  maxLaneCount: number;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Builds a stable permanent graph from commits already ordered by `git log --topo-order`.
 * Lanes carry an expected commit id between rows. A first parent continues in the node's
 * lane; already-visible parents converge into their existing lane; other parents fork
 * directly from the node and receive adjacent lanes.
 */
export function layoutCommits(commits: readonly CommitSummary[]): PermanentGraph {
  let lanes: string[] = [];
  let maxLaneCount = 0;
  const rows: GraphRow[] = [];

  commits.forEach((commit, row) => {
    let nodeLane = lanes.indexOf(commit.hash);
    const isHead = nodeLane < 0;
    if (nodeLane < 0) {
      nodeLane = lanes.length;
      lanes = [...lanes, commit.hash];
    }
    const before = [...lanes];
    const parents = unique(commit.parents);
    const remaining = before.filter((_, lane) => lane !== nodeLane);

    if (parents[0] && !remaining.includes(parents[0])) {
      remaining.splice(Math.min(nodeLane, remaining.length), 0, parents[0]);
    }
    let insertAt = parents[0] ? remaining.indexOf(parents[0]) + 1 : Math.min(nodeLane, remaining.length);
    for (const parent of parents.slice(1)) {
      if (remaining.includes(parent)) continue;
      remaining.splice(insertAt, 0, parent);
      insertAt += 1;
    }

    const connections: GraphConnection[] = [];
    before.forEach((hash, fromLane) => {
      if (fromLane === nodeLane) return;
      const toLane = remaining.indexOf(hash);
      if (toLane >= 0) connections.push({ fromLane, toLane, toHash: hash, kind: 'through' });
    });
    parents.forEach((hash, parentIndex) => {
      const toLane = remaining.indexOf(hash);
      if (toLane >= 0) connections.push({ fromLane: nodeLane, toLane, toHash: hash, kind: 'parent', parentIndex });
    });

    const laneCount = Math.max(before.length, remaining.length, 1);
    maxLaneCount = Math.max(maxLaneCount, laneCount);
    rows.push({
      row,
      commitHash: commit.hash,
      nodeLane,
      isHead,
      laneCount,
      lanesBefore: before,
      lanesAfter: [...remaining],
      connections
    });
    lanes = remaining;
  });

  return { rows, maxLaneCount };
}
