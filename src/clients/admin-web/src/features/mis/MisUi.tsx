/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — shared building blocks: cards, the chart card with its table view,
 * KPI tiles, change chips, legend, tooltip and the width hook every SVG chart sizes itself with.
 *
 * Copied from the approved 25 Oct preview, then made honest: a tile or card
 * names the item it shows (`data-mis-item`) and the answer fields it reads
 * (`data-mis-fields`); a value the server did not count shows the word and
 * the reason, never a number and never a bare dash.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, BarChart3, Minus, Table2 } from 'lucide-react';
import { MeasuredZero, NotMeasured, NotMeasuredPanel } from '@/components/state';
import { DELTA_TEXT, GHOST, SERIES } from './misTheme';
import { itemByKey, type MisFieldPath } from './misItems';
import type { MisChart, MisDelta, MisShown, MisTileModel } from './misView';
import type { LineSeries } from './MisLineChart';

/** Runs of consecutive drawable indices (a null breaks the run). */
export function runs(values: (number | null)[]): number[][] {
    const out: number[][] = [];
    let cur: number[] = [];
    values.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) {
            if (cur.length) out.push(cur);
            cur = [];
            return;
        }
        cur.push(i);
    });
    if (cur.length) out.push(cur);
    return out;
}

/** Trend line with a faint wash; no axes (the tile's number and change carry the values). A null day is a gap. */
export const Sparkline: React.FC<{ values: (number | null)[]; label: string; color?: string }> = ({ values, label, color = SERIES.s1 }) => {
    const clean = values.filter((v): v is number => v !== null && Number.isFinite(v));
    if (clean.length < 2 || values.length < 2) return <div className="h-8" />;
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const span = max - min || 1;
    const W = 120;
    const H = 32;
    const pad = 3;
    const x = (i: number) => (i / (values.length - 1)) * W;
    const y = (v: number) => pad + (1 - (v - min) / span) * (H - 2 * pad);
    const parts = runs(values).filter((r) => r.length > 1);
    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-8 w-full" role="img" aria-label={label}>
            {parts.map((run) => {
                const line = run.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(2)},${y(values[i] as number).toFixed(2)}`).join(' ');
                return (
                    <g key={run[0]}>
                        <path d={`${line} L${x(run[run.length - 1]).toFixed(2)},${H} L${x(run[0]).toFixed(2)},${H} Z`} fill={color} opacity={0.08} />
                        <path d={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                    </g>
                );
            })}
        </svg>
    );
};

export function cx(...parts: (string | false | null | undefined)[]): string {
    return parts.filter(Boolean).join(' ');
}

/** Width of an element, kept current with ResizeObserver (falls back to `fallback` where unsupported). */
export function useMeasuredWidth<T extends HTMLElement>(fallback = 640): [React.RefObject<T | null>, number] {
    const ref = useRef<T | null>(null);
    const [width, setWidth] = useState(fallback);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const measure = () => {
            const w = Math.round(el.getBoundingClientRect().width);
            if (w > 0) setWidth(w);
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, width];
}

export const CARD = 'rounded-2xl bg-white ring-1 ring-stone-200/80 shadow-[0_1px_2px_rgba(28,25,23,0.04),0_10px_28px_-18px_rgba(28,25,23,0.18)]';

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
    <section className={cx(CARD, className)}>{children}</section>
);

/** The two data attributes every tile and card root carries. */
export function itemAttrs(item: string, fields?: readonly MisFieldPath[]): { 'data-mis-item': string; 'data-mis-fields': string } {
    return { 'data-mis-item': item, 'data-mis-fields': (fields ?? itemByKey(item).fields).join(' ') };
}

export interface TableView {
    columns: string[];
    rows: (string | number)[][];
}

export interface LegendItem {
    label: string;
    color: string;
    shape?: 'rect' | 'line';
}

export const Legend: React.FC<{ items: LegendItem[] }> = ({ items }) => (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-stone-600" aria-label="Legend">
        {items.map((it) => (
            <li key={it.label} className="flex items-center gap-1.5">
                {it.shape === 'line'
                    ? <span aria-hidden className="h-[2px] w-3.5 rounded-full" style={{ background: it.color }} />
                    : <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />}
                <span>{it.label}</span>
            </li>
        ))}
    </ul>
);

/** A chart in a card: title, optional legend, and a Chart / Table switch (the table is the chart's accessible twin). */
export const ChartCard: React.FC<{
    item: string;
    fields?: readonly MisFieldPath[];
    title: string;
    subtitle?: string;
    legend?: LegendItem[];
    table?: TableView;
    footnote?: React.ReactNode;
    className?: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}> = ({ item, fields, title, subtitle, legend, table, footnote, className, action, children }) => {
    const [showTable, setShowTable] = useState(false);
    return (
        <section className={cx(CARD, 'flex min-w-0 flex-col p-5', className)} {...itemAttrs(item, fields)}>
            <header className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h3 className="text-[15px] font-medium leading-snug text-stone-900">{title}</h3>
                    {subtitle && <p className="mt-0.5 text-[13px] leading-snug text-stone-500">{subtitle}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {action}
                    {table && (
                        <button
                            type="button"
                            onClick={() => setShowTable((v) => !v)}
                            aria-pressed={showTable}
                            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-stone-500 ring-1 ring-stone-200 transition-colors hover:bg-stone-50 hover:text-stone-800"
                        >
                            {showTable ? <BarChart3 size={14} aria-hidden /> : <Table2 size={14} aria-hidden />}
                            {showTable ? 'Chart' : 'Table'}
                        </button>
                    )}
                </div>
            </header>
            {legend && legend.length > 1 && !showTable && <div className="mt-3"><Legend items={legend} /></div>}
            <div className="mt-4 min-w-0 flex-1">
                {showTable && table ? <DataTable table={table} /> : children}
            </div>
            {footnote && <p className="mt-3 text-[12px] leading-relaxed text-stone-500">{footnote}</p>}
        </section>
    );
};

/** A whole card body for an item the server does not count. */
export const NotMeasuredYet: React.FC<{ why: string }> = ({ why }) => (
    <NotMeasuredPanel title="Not measured yet" why={why} />
);

/** The body of a chart card: the chart, or the reason there is none, or a measured nothing. */
export function ChartBody<T>({ chart, checkedAt, children }: {
    chart: MisChart<T>;
    checkedAt: string;
    children: (data: T) => React.ReactNode;
}): React.ReactElement {
    if (chart.kind === 'notMeasured') return <NotMeasuredPanel why={chart.why} />;
    if (chart.kind === 'none') return <MeasuredZero what={chart.what} checkedAt={checkedAt} />;
    return <>{children(chart.data)}</>;
}

export const DataTable: React.FC<{ table: TableView }> = ({ table }) => (
    <div className="max-h-[320px] overflow-auto rounded-lg ring-1 ring-stone-100">
        <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-stone-50 text-stone-500">
                <tr>
                    {table.columns.map((c, k) => (
                        <th key={c} scope="col" className={cx('px-3 py-2 font-medium', k === 0 ? 'text-left' : 'text-right')}>{c}</th>
                    ))}
                </tr>
            </thead>
            <tbody className="tabular-nums text-stone-700">
                {table.rows.map((r, i) => (
                    <tr key={i} className="border-t border-stone-100">
                        {r.map((v, k) => (
                            <td key={k} className={cx('px-3 py-1.5', k === 0 ? 'text-left text-stone-600' : 'text-right')}>{v}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

/**
 * Signed change with direction icon; colour says whether the change is good or bad news.
 * An earlier period the server did not count is named as such, with the reason in the tooltip.
 */
export const Delta: React.FC<{ delta: MisDelta; className?: string }> = ({ delta, className }) => {
    if (delta === null) return null;
    if ('previousNotMeasured' in delta) {
        return (
            <span className={cx('text-[12px] text-stone-500', className)} title={delta.previousNotMeasured}>
                Earlier period not measured
            </span>
        );
    }
    const { text, good } = delta;
    const flat = good === null;
    const up = text.startsWith('+') || text.startsWith('up');
    const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
    const tone = flat ? DELTA_TEXT.flat : good ? DELTA_TEXT.good : DELTA_TEXT.bad;
    return (
        <span className={cx('inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums', tone, className)}>
            <Icon size={14} strokeWidth={2.25} aria-hidden />
            {text}
            <span className="sr-only">{flat ? ' (no change)' : good ? ' (better)' : ' (worse)'}</span>
        </span>
    );
};

export const KpiTile: React.FC<{ tile: MisTileModel; compare: boolean }> = ({ tile, compare }) => (
    <div className="flex min-w-0 flex-col bg-white px-5 pb-4 pt-4" data-testid={`kpi-${tile.item}`} {...itemAttrs(tile.item, tile.fields)}>
        <p className="truncate text-[13px] font-medium text-stone-700" title={tile.hint}>{tile.label}</p>
        {tile.hint && <p className="text-[12px] leading-snug text-stone-500">{tile.hint}</p>}
        {tile.current.kind === 'value'
            ? (
                <>
                    <p className="mt-2 text-[26px] font-medium leading-none tracking-[-0.01em] text-stone-900" data-testid={`kpi-${tile.item}-value`}>
                        {tile.current.text}
                    </p>
                    <div className="mt-2 flex min-h-4 flex-wrap items-center gap-1.5">
                        {compare && (
                            <>
                                <Delta delta={tile.delta} />
                                {tile.previous.kind === 'value' && (
                                    <span className="truncate text-[12px] text-stone-400">from {tile.previous.text}</span>
                                )}
                            </>
                        )}
                    </div>
                    <div className="mt-3">
                        {tile.spark && <Sparkline values={tile.spark} label={`${tile.label}, each day of the range`} />}
                    </div>
                </>
            )
            : (
                <div className="mt-2" data-testid={`kpi-${tile.item}-value`}>
                    <NotMeasured why={tile.current.why} />
                    <p className="mt-1 text-[12px] leading-snug text-stone-500">{tile.current.why}</p>
                </div>
            )}
    </div>
);

/** KPI tiles in one panel, divided by hairlines instead of separate cards. */
export const KpiStrip: React.FC<{ tiles: MisTileModel[]; compare: boolean; columns?: string }> = ({ tiles, compare, columns }) => (
    <section className={cx(CARD, 'overflow-hidden')} aria-label="Key numbers">
        <div className={cx('grid gap-px bg-stone-200/70', columns ?? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-6')}>
            {tiles.map((t) => <KpiTile key={t.item} tile={t} compare={compare} />)}
        </div>
    </section>
);

export interface TooltipRow {
    label: string;
    value: string;
    color: string;
    shape?: 'line' | 'rect';
}

/** Floating readout. Values lead, labels follow; keyed with a short line in the series colour. */
export const ChartTooltip: React.FC<{ x: number; y: number; width: number; title: string; rows: TooltipRow[]; footer?: string }> = ({ x, y, width, title, rows, footer }) => {
    const flip = x > width * 0.62;
    return (
        <div
            role="status"
            className="pointer-events-none absolute z-10 min-w-[160px] max-w-[260px] rounded-xl bg-white px-3 py-2.5 text-[12px] shadow-[0_8px_28px_-6px_rgba(28,25,23,0.25)] ring-1 ring-stone-200"
            style={{ left: flip ? undefined : x + 14, right: flip ? width - x + 14 : undefined, top: Math.max(0, y) }}
        >
            <p className="mb-1.5 text-stone-500">{title}</p>
            <ul className="space-y-1">
                {rows.map((r) => (
                    <li key={r.label} className="flex items-center gap-2">
                        {r.shape === 'rect'
                            ? <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: r.color }} />
                            : <span aria-hidden className="h-[2px] w-3 shrink-0 rounded-full" style={{ background: r.color }} />}
                        <span className="font-medium tabular-nums text-stone-900">{r.value}</span>
                        <span className="truncate text-stone-500">{r.label}</span>
                    </li>
                ))}
            </ul>
            {footer && <p className="mt-1.5 border-t border-stone-100 pt-1.5 text-stone-500">{footer}</p>}
        </div>
    );
};

/** Nice axis ticks between min and max (about `count` of them). */
export function niceTicks(min: number, max: number, count = 4): number[] {
    if (!(max > min)) return [min];
    const raw = (max - min) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const out: number[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(10)));
    return out;
}

/** Indices of x labels that fit without colliding (always includes the first and last). */
export function labelIndices(n: number, plotWidth: number, minGap = 64): number[] {
    if (n <= 1) return [0];
    const fit = Math.max(2, Math.floor(plotWidth / minGap));
    const step = Math.max(1, Math.ceil((n - 1) / (fit - 1)));
    const out: number[] = [];
    for (let i = 0; i < n; i += step) out.push(i);
    const last = out[out.length - 1];
    if (last !== n - 1) {
        if ((n - 1 - last) * (plotWidth / (n - 1)) < minGap * 0.8) out.pop();
        out.push(n - 1);
    }
    return out;
}

/**
 * Table view for charts: one row per x label, one column per series.
 * An absent value is a word (`empty`, default "not yet"), never a dash.
 */
export function seriesTable(
    firstHeader: string,
    labels: string[],
    cols: { name: string; values: (number | null)[]; fmt: (v: number) => string; empty?: string }[],
): TableView {
    return {
        columns: [firstHeader, ...cols.map((c) => c.name)],
        rows: labels.map((l, i) => [l, ...cols.map((c) => {
            const v = c.values[i];
            return v === null || v === undefined || !Number.isFinite(v) ? (c.empty ?? 'not yet') : c.fmt(v);
        })]),
    };
}

/** Section heading row inside a page. */
export const Row: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <div className={cx('grid grid-cols-12 gap-5', className)}>{children}</div>
);

export const PREVIOUS_LABEL = 'Previous period';

/** Legend for line charts: the period before appears only when a served previous line is drawn. */
export function compareLegend(color: string, label: string, showPrevious: boolean): LegendItem[] {
    return showPrevious
        ? [{ label, color, shape: 'line' }, { label: PREVIOUS_LABEL, color: '#a8a29e', shape: 'line' }]
        : [{ label, color, shape: 'line' }];
}

export interface MisSectionProps<V> {
    view: V;
    compare: boolean;
    /** "15 Nov 2026, 2:32 pm India time" — when the answer was counted. */
    checkedAt: string;
}

export const Shown: React.FC<{ shown: MisShown }> = ({ shown }) =>
    shown.kind === 'value' ? <>{shown.text}</> : <NotMeasured why={shown.why} />;

/** A line with the period before drawn only from served previous values. */
export function withPrevious(current: LineSeries, previous: (number | null)[] | null, compare: boolean): LineSeries[] {
    return compare && previous
        ? [{ key: 'prev', label: 'Previous period', color: GHOST, values: previous, ghost: true }, current]
        : [current];
}
