import type { GraphRow } from './layout.js';

export interface Point { x: number; y: number }

export interface GraphSegment {
  kind: 'incoming' | 'through' | 'parent';
  from: Point;
  to: Point;
  lane: number;
  parentIndex?: number;
}

export interface RowGeometry {
  width: number;
  height: number;
  node: Point;
  segments: GraphSegment[];
}

export function laneX(lane: number, laneWidth = 16): number {
  return laneWidth / 2 + lane * laneWidth;
}

export function createRowGeometry(row: GraphRow, rowHeight = 28, laneWidth = 16): RowGeometry {
  const middle = rowHeight / 2;
  const segments: GraphSegment[] = [];

  row.lanesBefore.forEach((_, lane) => {
    if (row.isHead && lane === row.nodeLane) return;
    segments.push({
      kind: 'incoming',
      lane,
      from: { x: laneX(lane, laneWidth), y: 0 },
      to: { x: laneX(lane, laneWidth), y: middle }
    });
  });
  row.connections.forEach(connection => {
    const base = {
      kind: connection.kind,
      lane: connection.fromLane,
      from: { x: laneX(connection.fromLane, laneWidth), y: middle },
      to: { x: laneX(connection.toLane, laneWidth), y: rowHeight }
    } as GraphSegment;
    if (connection.parentIndex !== undefined) base.parentIndex = connection.parentIndex;
    segments.push(base);
  });

  return {
    width: Math.max(row.laneCount, 1) * laneWidth,
    height: rowHeight,
    node: { x: laneX(row.nodeLane, laneWidth), y: middle },
    segments
  };
}
