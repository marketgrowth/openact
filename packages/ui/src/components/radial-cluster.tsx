import type { KeyboardEvent, ReactElement } from "react";
import { cn } from "../lib/utils";

/*
 * RadialCluster: many small items in a few groups, drawn as wedges around a hub.
 * Each group is a wedge, sized by its count. Each item is a dot on one of a few rings, from the hub out.
 * Use it to show the shape of a set, such as the searches for a topic grouped by aspect.
 * Give a table view next to it too: a chart of dots is not the only way that people can read the items.
 *
 * Colors come from the project identity tokens (--pc-*), one per group, in turn. Tones use meaning tokens.
 */

export interface RadialGroup {
  label: string;
  /** A second line under the label, such as "12 sub-queries". */
  detail?: string;
}

export interface RadialItem {
  id: string;
  /** Index into groups. */
  group: number;
  /** Ring from the hub out, from 0 to rings - 1. */
  ring: number;
  /** The name that the dot's tooltip and screen readers use. */
  label: string;
  /** An open dot, for an item of a second kind (such as inferred, not observed). */
  hollow?: boolean;
  /** A result for the item: good, mixed or bad. Draws a ring around the dot. */
  tone?: "good" | "mixed" | "bad";
}

export interface RadialClusterProps {
  groups: RadialGroup[];
  items: RadialItem[];
  rings: number;
  /** The text in the hub: a large value and a short label under it. */
  center: { value: string; label: string };
  /** Says what the chart shows, for screen readers. */
  label: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onGroupSelect?: (group: number) => void;
  className?: string;
}

const COLORS = ["indigo", "violet", "amber", "teal", "rose", "slate"];
export const radialGroupColor = (i: number) => `var(--pc-${COLORS[i % COLORS.length]})`;
const TONES = { good: "var(--s-done)", mixed: "var(--warn-foreground)", bad: "var(--p-high)" } as const;

const C = 500;
const R0 = 84;
const R1 = 360;
const GAP = 0.012;

export function RadialCluster({ groups, items, rings, center, label, selectedId, onSelect, onGroupSelect, className }: RadialClusterProps) {
  const by = groups.map((_, i) => items.filter((q) => q.group === i));
  const used = by.filter((x) => x.length).length;
  const usable = Math.PI * 2 - GAP * used;
  const total = items.length || 1;
  const ringR = (r: number) => R0 + 34 + (rings > 1 ? r / (rings - 1) : 0) * (R1 - R0 - 50);
  const pt = (r: number, a: number): [number, number] => [C + r * Math.cos(a), C + r * Math.sin(a)];
  const key = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };

  let a = -Math.PI / 2;
  const wedges: ReactElement[] = [];
  const spokes: ReactElement[] = [];
  const dots: ReactElement[] = [];
  const labels: ReactElement[] = [];

  by.forEach((list, i) => {
    if (!list.length) return;
    const span = (list.length / total) * usable;
    const a0 = a;
    const a1 = a + span;
    a = a1 + GAP;
    const color = radialGroupColor(i);
    const [x0, y0] = pt(R1, a0);
    const [x1, y1] = pt(R1, a1);
    const [x2, y2] = pt(R0, a1);
    const [x3, y3] = pt(R0, a0);
    const big = span > Math.PI ? 1 : 0;
    wedges.push(
      <path
        key={i}
        d={`M${x3} ${y3} L${x0} ${y0} A${R1} ${R1} 0 ${big} 1 ${x1} ${y1} L${x2} ${y2} A${R0} ${R0} 0 ${big} 0 ${x3} ${y3}Z`}
        style={{ fill: `color-mix(in oklab, ${color} 12%, var(--background))`, stroke: "var(--background)", strokeWidth: 2 }}
      />
    );
    for (let ring = 0; ring < rings; ring++) {
      const rq = list.filter((q) => q.ring === ring);
      rq.forEach((q, k) => {
        const ang = a0 + ((k + 0.5) / rq.length) * span;
        const r = ringR(ring) + ((k % 3) - 1) * 9;
        const [x, y] = pt(r, ang);
        const [sx, sy] = pt(R0, ang);
        const sel = selectedId === q.id;
        spokes.push(
          <line key={q.id} x1={sx.toFixed(1)} y1={sy.toFixed(1)} x2={x.toFixed(1)} y2={y.toFixed(1)} style={{ stroke: `color-mix(in oklab, ${color} 30%, transparent)`, strokeWidth: 1 }} />
        );
        dots.push(
          <circle
            key={q.id}
            data-item={q.id}
            cx={x.toFixed(1)}
            cy={y.toFixed(1)}
            r={q.hollow ? 7.5 : 9}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={q.label}
            aria-pressed={onSelect ? sel : undefined}
            onClick={onSelect ? () => onSelect(q.id) : undefined}
            onKeyDown={onSelect ? key(() => onSelect(q.id)) : undefined}
            className={cn(onSelect && "cursor-pointer outline-none focus-visible:[stroke:var(--ring)] focus-visible:[stroke-width:5]")}
            style={{
              fill: q.hollow ? "var(--background)" : color,
              stroke: sel ? "var(--foreground)" : q.tone ? TONES[q.tone] : color,
              strokeWidth: sel ? 5 : q.tone ? 4 : q.hollow ? 3 : 0
            }}
          >
            <title>{q.label}</title>
          </circle>
        );
      });
    }
    const mid = (a0 + a1) / 2;
    const [lx, ly] = pt(R1 + 18, mid);
    const up = Math.sin(mid) < -0.3;
    const down = Math.sin(mid) > 0.3;
    const ty = up ? ly - 30 : down ? ly + 4 : ly - 12;
    const anchor = Math.abs(Math.cos(mid)) < 0.18 ? "middle" : Math.cos(mid) >= 0 ? "start" : "end";
    labels.push(
      <text
        key={i}
        x={lx.toFixed(1)}
        y={ty.toFixed(1)}
        textAnchor={anchor}
        role={onGroupSelect ? "button" : undefined}
        tabIndex={onGroupSelect ? 0 : undefined}
        onClick={onGroupSelect ? () => onGroupSelect(i) : undefined}
        onKeyDown={onGroupSelect ? key(() => onGroupSelect(i)) : undefined}
        className={cn(onGroupSelect && "cursor-pointer outline-none focus-visible:underline")}
      >
        <tspan style={{ fill: "var(--foreground)", fontSize: 26, fontWeight: 600 }}>{groups[i]!.label}</tspan>
        {groups[i]!.detail && (
          <tspan x={lx.toFixed(1)} dy="1.15em" style={{ fill: "var(--muted-foreground)", fontSize: 20 }}>
            {groups[i]!.detail}
          </tspan>
        )}
      </text>
    );
  });

  return (
    <div className={cn("w-full", className)} data-slot="radial-cluster">
      <svg viewBox="-280 70 1560 860" role="img" aria-label={label} className="h-auto w-full">
        <g>{wedges}</g>
        <g>{spokes}</g>
        <circle cx={C} cy={C} r={R0 - 8} style={{ fill: "var(--card)", stroke: "var(--border)", strokeWidth: 2 }} />
        <text x={C} y={C + 6} textAnchor="middle" style={{ fill: "var(--foreground)", fontSize: 44, fontWeight: 700 }}>
          {center.value}
        </text>
        <text x={C} y={C + 36} textAnchor="middle" style={{ fill: "var(--muted-foreground)", fontSize: 15, letterSpacing: "0.08em" }}>
          {center.label.toUpperCase()}
        </text>
        <g>{dots}</g>
        <g>{labels}</g>
      </svg>
    </div>
  );
}
