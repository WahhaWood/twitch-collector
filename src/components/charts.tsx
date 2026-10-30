"use client";

import { type ReactNode, useState } from "react";

// Chart colors validated for CVD separation and contrast in both themes (dataviz validator, 2026-10-30).
export const TONE = {
  violet: "bg-acc",
  emerald: "bg-ok",
  amber: "bg-warn",
  neutral: "bg-mut",
  faint: "bg-track",
} as const;
export type Tone = keyof typeof TONE;

const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export type Column = { label: string; value: number; tooltip: ReactNode };

// Single-series column chart: one hue, 4px rounded caps on a shared baseline, per-column hover/focus tooltip.
export function ColumnChart({ data, tone = "violet", height = 160, format = (v: number) => compact.format(v) }: {
  data: Column[];
  tone?: Tone;
  height?: number;
  format?: (v: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const ticks = [max, max / 2, 0];
  const labelAt = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);

  return (
    <div className="flex gap-2">
      <div className="flex shrink-0 flex-col justify-between pb-5 text-right text-[11px] tabular-nums text-mut" style={{ height }}>
        {ticks.map((t) => (
          <span key={t} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
            {format(t)}
          </span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="relative" style={{ height: height - 20 }}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-line" style={{ bottom: `${(t / max) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-0.5">
            {data.map((d, i) => (
              <button
                key={d.label + i}
                type="button"
                aria-label={`${d.label}: ${format(d.value)}`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                onFocus={() => setActive(i)}
                onBlur={() => setActive((a) => (a === i ? null : a))}
                className="flex h-full min-w-0 flex-1 cursor-default items-end justify-center outline-none"
              >
                <span
                  className={`block w-full max-w-6 rounded-t ${TONE[tone]} transition-opacity ${active !== null && active !== i ? "opacity-50" : ""}`}
                  style={{ height: d.value > 0 ? `max(2px, ${(d.value / max) * 100}%)` : 0 }}
                />
              </button>
            ))}
          </div>
          {active !== null && (
            <div
              role="tooltip"
              className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-sf px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: `clamp(60px, ${((active + 0.5) / data.length) * 100}%, calc(100% - 60px))` }}
            >
              {data[active].tooltip}
            </div>
          )}
        </div>
        <div className="relative mt-1 h-4 text-[11px] text-mut">
          {data.map((d, i) =>
            labelAt.has(i) ? (
              <span
                key={i}
                className="absolute whitespace-nowrap"
                style={
                  i === 0
                    ? { left: 0 }
                    : i === data.length - 1
                      ? { right: 0 }
                      : { left: `${((i + 0.5) / data.length) * 100}%`, transform: "translateX(-50%)" }
                }
              >
                {d.label}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

export type BarRow = { label: string; value: number; display: string; sub?: string };

// Horizontal bars, value at the tip; the list itself doubles as the table view.
export function BarList({ rows, tone = "violet" }: { rows: BarRow[]; tone?: Tone }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums text-mut">{r.display}</span>
          </div>
          <div className="h-2 w-full">
            <div className={`h-full rounded-r ${TONE[tone]}`} style={{ width: r.value > 0 ? `max(2px, ${(r.value / max) * 100}%)` : 0 }} />
          </div>
          {r.sub && <span className="text-xs text-mut">{r.sub}</span>}
        </li>
      ))}
    </ul>
  );
}

export type Segment = { label: string; value: number; tone: Tone };

// Part-to-whole meter: 2px surface gaps between segments, legend with counts carries identity and values.
export function StackedMeter({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        {total === 0 ? (
          <div className={`h-full w-full ${TONE.faint}`} />
        ) : (
          shown.map((s) => (
            <div key={s.label} title={`${s.label}: ${s.value}`} className={`h-full ${TONE[s.tone]}`} style={{ flexGrow: s.value, flexBasis: 0, minWidth: 3 }} />
          ))
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-mut">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-sm ${TONE[s.tone]}`} />
            {s.label}
            <span className="font-medium tabular-nums text-fg">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StatTile({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-sf p-3">
      <span className="truncate text-xs text-mut">{label}</span>
      <span className={`text-2xl font-semibold tabular-nums ${accent ? "text-acc-t" : ""}`}>{value}</span>
      {hint && <span className="truncate text-xs text-mut">{hint}</span>}
    </div>
  );
}
