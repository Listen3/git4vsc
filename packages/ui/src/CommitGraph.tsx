import { createRowGeometry, type GraphRow } from '@git4vsc/git-graph';

const colors = ['#4f9cf9', '#e06c75', '#98c379', '#c678dd', '#e5c07b', '#56b6c2', '#d19a66'];
export type FilteredConnection = 'none' | 'solid' | 'dashed';

function curve(fromX: number, fromY: number, toX: number, toY: number): string {
  const middle = (fromY + toY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${middle}, ${toX} ${middle}, ${toX} ${toY}`;
}

export function CommitGraph({ row, width, filtered }: { row: GraphRow; width: number; filtered?: { top: FilteredConnection; bottom: FilteredConnection } }) {
  if (filtered) return <FilteredGraph width={width} top={filtered.top} bottom={filtered.bottom} />;
  const geometry = createRowGeometry(row);
  return (
    <svg className="git-graph" width={width} height={geometry.height} aria-hidden="true">
      {geometry.segments.map((segment, index) => (
        <path
          key={`${segment.kind}-${segment.lane}-${index}`}
          d={curve(segment.from.x, segment.from.y, segment.to.x, segment.to.y)}
          stroke={colors[segment.lane % colors.length]}
          fill="none"
          strokeWidth="1.6"
        />
      ))}
      <circle
        cx={geometry.node.x}
        cy={geometry.node.y}
        r="4"
        fill="var(--git4vsc-background)"
        stroke={colors[row.nodeLane % colors.length]}
        strokeWidth="2"
      />
    </svg>
  );
}

function FilteredGraph({ width, top, bottom }: { width: number; top: FilteredConnection; bottom: FilteredConnection }) {
  const x = 10;
  const middle = 12.5;
  const color = 'var(--vscode-gitDecoration-modifiedResourceForeground, #8f78c6)';
  return <svg className="git-graph" width={width} height="25" aria-hidden="true">
    {top !== 'none' && <path d={`M ${x} 0 V ${middle}`} stroke={color} strokeWidth="1.6" strokeDasharray={top === 'dashed' ? '2.5 3' : undefined} />}
    {bottom !== 'none' && <path d={`M ${x} ${middle} V 25`} stroke={color} strokeWidth="1.6" strokeDasharray={bottom === 'dashed' ? '2.5 3' : undefined} />}
    <circle cx={x} cy={middle} r="4" fill={color} />
  </svg>;
}
