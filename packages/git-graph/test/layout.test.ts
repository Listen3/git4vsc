import { describe, expect, it } from 'vitest';
import type { CommitSummary } from '@git4vsc/shared-types';
import { createRowGeometry, layoutCommits } from '../src/index.js';

function commit(hash: string, parents: string[]): CommitSummary {
  return { hash, parents, authorName: 'A', authorEmail: 'a@example.test', authorTime: 0, committerTime: 0, subject: hash, refs: [] };
}

describe('permanent graph layout', () => {
  const commits = [
    commit('M', ['A', 'B', 'B', 'C']),
    commit('A', ['R']),
    commit('B', ['R']),
    commit('C', ['R']),
    commit('R', [])
  ];

  it('handles octopus merges, duplicate parents and convergence', () => {
    const graph = layoutCommits(commits);
    expect(graph.rows.map(row => ({ node: row.nodeLane, before: row.lanesBefore, after: row.lanesAfter }))).toMatchInlineSnapshot(`
      [
        {
          "after": [
            "A",
            "B",
            "C",
          ],
          "before": [
            "M",
          ],
          "node": 0,
        },
        {
          "after": [
            "R",
            "B",
            "C",
          ],
          "before": [
            "A",
            "B",
            "C",
          ],
          "node": 0,
        },
        {
          "after": [
            "R",
            "C",
          ],
          "before": [
            "R",
            "B",
            "C",
          ],
          "node": 1,
        },
        {
          "after": [
            "R",
          ],
          "before": [
            "R",
            "C",
          ],
          "node": 1,
        },
        {
          "after": [],
          "before": [
            "R",
          ],
          "node": 0,
        },
      ]
    `);
    expect(graph.rows[0]?.connections.filter(edge => edge.kind === 'parent')).toHaveLength(3);
  });

  it('starts every merge branch at the node center and keeps row boundaries continuous', () => {
    const graph = layoutCommits(commits);
    const first = graph.rows[0]!;
    const geometry = createRowGeometry(first, 28, 16);
    const parents = geometry.segments.filter(segment => segment.kind === 'parent');
    expect(parents.map(segment => segment.from)).toEqual([
      { x: 8, y: 14 }, { x: 8, y: 14 }, { x: 8, y: 14 }
    ]);
    expect(parents.map(segment => segment.to)).toEqual([
      { x: 8, y: 28 }, { x: 24, y: 28 }, { x: 40, y: 28 }
    ]);
    graph.rows.slice(0, -1).forEach((row, index) => expect(row.lanesAfter).toEqual(graph.rows[index + 1]?.lanesBefore));
  });

  it('keeps the same color id when an edge bends into another lane', () => {
    const graph = layoutCommits(commits);
    graph.rows.slice(0, -1).forEach((row, index) => {
      const next = graph.rows[index + 1]!;
      row.connections.forEach(edge => expect(edge.colorId).toBe(next.laneColorsBefore[edge.toLane]));
    });
  });

  it('keeps isolated roots in independent lanes', () => {
    const graph = layoutCommits([commit('A', ['R1']), commit('X', ['R2']), commit('R1', []), commit('R2', [])]);
    expect(graph.maxLaneCount).toBeGreaterThanOrEqual(2);
    expect(graph.rows.map(row => row.commitHash)).toEqual(['A', 'X', 'R1', 'R2']);
  });
});
