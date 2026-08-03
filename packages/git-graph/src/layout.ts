import type { CommitSummary } from '@git4vsc/shared-types';

export interface GraphConnection {
  fromLane: number;
  toLane: number;
  toHash: string;
  colorId: number;
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
  laneColorsBefore: readonly number[];
  laneColorsAfter: readonly number[];
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
  let lanes: Array<{ hash: string; colorId: number }> = [];
  let nextColorId = 0;
  let maxLaneCount = 0;
  const rows: GraphRow[] = [];

  commits.forEach((commit, row) => {
    let nodeLane = lanes.findIndex(lane => lane.hash === commit.hash);
    const isHead = nodeLane < 0;
    if (nodeLane < 0) {
      nodeLane = lanes.length;
      lanes = [...lanes, { hash: commit.hash, colorId: nextColorId++ }];
    }
    const before = lanes.map(lane => ({ ...lane }));
    const parents = unique(commit.parents);
    const remaining = before.filter((_, lane) => lane !== nodeLane);

    if (parents[0] && !remaining.some(lane => lane.hash === parents[0])) {
      remaining.splice(Math.min(nodeLane, remaining.length), 0, { hash: parents[0], colorId: before[nodeLane]!.colorId });
    }
    let insertAt = parents[0] ? remaining.findIndex(lane => lane.hash === parents[0]) + 1 : Math.min(nodeLane, remaining.length);
    for (const parent of parents.slice(1)) {
      if (remaining.some(lane => lane.hash === parent)) continue;
      remaining.splice(insertAt, 0, { hash: parent, colorId: nextColorId++ });
      insertAt += 1;
    }

    const connections: GraphConnection[] = [];
    before.forEach((lane, fromLane) => {
      if (fromLane === nodeLane) return;
      const toLane = remaining.findIndex(next => next.hash === lane.hash);
      if (toLane >= 0) connections.push({ fromLane, toLane, toHash: lane.hash, colorId: lane.colorId, kind: 'through' });
    });
    parents.forEach((hash, parentIndex) => {
      const toLane = remaining.findIndex(lane => lane.hash === hash);
      if (toLane >= 0) connections.push({ fromLane: nodeLane, toLane, toHash: hash, colorId: remaining[toLane]!.colorId, kind: 'parent', parentIndex });
    });

    const laneCount = Math.max(before.length, remaining.length, 1);
    maxLaneCount = Math.max(maxLaneCount, laneCount);
    rows.push({
      row,
      commitHash: commit.hash,
      nodeLane,
      isHead,
      laneCount,
      lanesBefore: before.map(lane => lane.hash),
      lanesAfter: remaining.map(lane => lane.hash),
      laneColorsBefore: before.map(lane => lane.colorId),
      laneColorsAfter: remaining.map(lane => lane.colorId),
      connections
    });
    lanes = remaining;
  });

  return { rows, maxLaneCount };
}
