/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — the HTML-built charts: bar tables (ranked bars with right-aligned
 * numbers, optionally expandable), the sign-up funnel, the hour × weekday heatmap, the cohort
 * grid and the part-to-whole bar.
 *
 * Copied from the approved preview, then made honest: an absent value is a
 * word ("not yet", "nobody", or the not-measured reason), never a dash.
 */
import React, { useState } from 'react';
import { ArrowDown, ChevronRight } from 'lucide-react';
import { NotMeasured } from '@/components/state';
import { FUNNEL_RAMP, SEQ_INK, SEQ_RAMP, SERIES, seqIndex } from './misTheme';
import { ChartTooltip, Delta, cx, itemAttrs, useMeasuredWidth } from './MisUi';
import { fmtHour, fmtInt, fmtPct, fmtPctPoints } from './misFormat';
import type { CohortRowModel, FunnelStepModel, MisDelta } from './misView';

// ---------- Bar table ----------

export interface BarRow {
    key: string;
    label: string;
    value: number;
    display: string;
    delta?: MisDelta;
    extra?: React.ReactNode[];
    color?: string;
    lead?: React.ReactNode;
    children?: BarRow[];
}

export const BarTable: React.FC<{
    rows: BarRow[];
    caption: string;
    labelHeader: string;
    valueHeader: string;
    extraHeaders?: string[];
    compare: boolean;
    color?: string;
    max?: number;
}> = ({ rows, caption, labelHeader, valueHeader, extraHeaders = [], compare, color = SERIES.s1, max }) => {
    const [open, setOpen] = useState<Set<string>>(() => new Set());
    const top = max ?? Math.max(0, ...rows.map((r) => r.value));
    const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

    const renderRow = (r: BarRow, depth: number): React.ReactNode[] => {
        const expandable = !!r.children?.length;
        const isOpen = open.has(r.key);
        const pct = top ? Math.max(0, Math.min(1, r.value / top)) : 0;
        const out: React.ReactNode[] = [(
            <tr key={r.key} className={cx('border-t border-stone-100 first:border-t-0', depth > 0 && 'bg-stone-50/60')}>
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <div className={cx('flex min-w-0 items-center gap-1.5', depth > 0 && 'pl-6')}>
                        {expandable && (
                            <button
                                type="button"
                                onClick={() => toggle(r.key)}
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? 'Hide' : 'Show'} the rows inside ${r.label}`}
                                className="-ml-1 rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                            >
                                <ChevronRight size={15} className={cx('transition-transform', isOpen && 'rotate-90')} aria-hidden />
                            </button>
                        )}
                        {r.lead}
                        <span className={cx('truncate', depth > 0 ? 'text-stone-600' : 'text-stone-800')}>{r.label}</span>
                    </div>
                </th>
                <td className="w-[38%] py-2 pr-4 align-middle">
                    <div className="h-2 w-full">
                        <div className="h-2 rounded-r-[4px]" style={{ width: `${pct * 100}%`, background: r.color ?? color, opacity: depth > 0 ? 0.6 : 1 }} />
                    </div>
                </td>
                <td className="whitespace-nowrap py-2 pl-2 text-right tabular-nums text-stone-900">{r.display}</td>
                {extraHeaders.map((h, k) => (
                    <td key={h} className="whitespace-nowrap py-2 pl-4 text-right tabular-nums text-stone-600">{r.extra?.[k] ?? ''}</td>
                ))}
                {compare && (
                    <td className="whitespace-nowrap py-2 pl-4 text-right">{r.delta ? <Delta delta={r.delta} /> : null}</td>
                )}
            </tr>
        )];
        if (expandable && isOpen) r.children?.forEach((c) => out.push(...renderRow(c, depth + 1)));
        return out;
    };

    return (
        <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
                <caption className="sr-only">{caption}</caption>
                <thead>
                    <tr className="text-[12px] text-stone-500">
                        <th scope="col" className="pb-2 text-left font-medium">{labelHeader}</th>
                        <th scope="col" className="pb-2"><span className="sr-only">Bar</span></th>
                        <th scope="col" className="whitespace-nowrap pb-2 pl-2 text-right font-medium">{valueHeader}</th>
                        {extraHeaders.map((h) => <th key={h} scope="col" className="whitespace-nowrap pb-2 pl-4 text-right font-medium">{h}</th>)}
                        {compare && <th scope="col" className="whitespace-nowrap pb-2 pl-4 text-right font-medium">Change</th>}
                    </tr>
                </thead>
                <tbody>{rows.flatMap((r) => renderRow(r, 0))}</tbody>
            </table>
        </div>
    );
};

// ---------- Funnel ----------

/**
 * The sign-up funnel. Each step carries its own item key. A step the server
 * does not count (installs) shows the word and the reason. Percentages are of
 * sign-ups (phone verified), and the habit step is of those old enough to judge.
 */
export const Funnel: React.FC<{ steps: FunnelStepModel[]; compare: boolean }> = ({ steps, compare }) => (
    <ol className="space-y-1" aria-label="Sign-up funnel">
        {steps.map((s, k) => {
            const measured = s.current.kind === 'value';
            const width = s.share ? Number.parseFloat(s.share.text) : measured ? 100 : 0;
            return (
                <li key={s.item} {...itemAttrs(s.item, s.fields)}>
                    {k > 0 && (
                        <div className="flex items-center gap-1.5 py-1 pl-8 text-[12px] text-stone-500">
                            <ArrowDown size={13} aria-hidden />
                        </div>
                    )}
                    <div className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-3">
                        {/* The step marker carries no digit: every digit inside an item is a counted number. */}
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-100" aria-hidden>
                            <span className="h-2 w-2 rounded-full" style={{ background: FUNNEL_RAMP[k % FUNNEL_RAMP.length] }} />
                        </span>
                        <div className="min-w-0">
                            <div className="flex items-baseline justify-between gap-3">
                                <span className="truncate text-[13px] text-stone-800">{s.label}</span>
                                <span className="whitespace-nowrap text-[13px] tabular-nums text-stone-900">
                                    {s.current.kind === 'value' ? s.current.text : <NotMeasured why={s.current.why} />}
                                </span>
                            </div>
                            <div className="mt-1.5 h-3 w-full rounded-[4px] bg-stone-100/70">
                                <div className="h-3 rounded-[4px]" style={{ width: `${Math.max(measured ? 0.5 : 0, Math.min(100, width))}%`, background: FUNNEL_RAMP[k % FUNNEL_RAMP.length] }} />
                            </div>
                            {s.current.kind === 'notMeasured' && <p className="mt-1 text-[12px] text-stone-500">{s.current.why}</p>}
                        </div>
                        <div className="w-[120px] text-right">
                            {s.share && (
                                <p className="text-[13px] font-medium tabular-nums text-stone-900">
                                    {s.share.text} <span className="font-normal text-stone-500">{s.share.of}</span>
                                </p>
                            )}
                            {compare && measured && <Delta delta={s.delta} />}
                        </div>
                    </div>
                </li>
            );
        })}
    </ol>
);

// ---------- Heatmap ----------

export const ScaleLegend: React.FC<{ low: string; high: string }> = ({ low, high }) => (
    <div className="flex items-center gap-2 text-[12px] text-stone-500" aria-hidden>
        <span>{low}</span>
        <span className="flex gap-[2px]">
            {SEQ_RAMP.map((c) => <span key={c} className="h-2.5 w-5 rounded-[2px] ring-1 ring-inset ring-stone-900/5" style={{ background: c }} />)}
        </span>
        <span>{high}</span>
    </div>
);

export const Heatmap: React.FC<{ grid: number[][]; max: number; rowLabels: string[]; ariaLabel: string }> = ({ grid, max, rowLabels, ariaLabel }) => {
    const [ref, width] = useMeasuredWidth<HTMLDivElement>();
    const [hover, setHover] = useState<{ r: number; h: number } | null>(null);
    const labelW = 44;
    const cellW = (width - labelW) / 24;
    return (
        <div ref={ref} className="relative" role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: `${labelW - 2}px repeat(24, minmax(0, 1fr))` }}>
                {grid.map((row, r) => (
                    <React.Fragment key={rowLabels[r]}>
                        <span className="flex items-center text-[12px] text-stone-500">{rowLabels[r]}</span>
                        {row.map((v, h) => (
                            <span
                                key={h}
                                className={cx('h-7 rounded-[3px]', hover && hover.r === r && hover.h === h && 'ring-2 ring-stone-900/70')}
                                style={{ background: SEQ_RAMP[seqIndex(max ? v / max : 0)] }}
                                onPointerEnter={() => setHover({ r, h })}
                            />
                        ))}
                    </React.Fragment>
                ))}
                <span />
                {Array.from({ length: 24 }, (_, h) => (
                    <span key={h} className="pt-1 text-center text-[11px] text-stone-500">{h % 3 === 0 ? fmtHour(h).replace(' ', '') : ''}</span>
                ))}
            </div>
            {hover && (
                <ChartTooltip
                    x={labelW + cellW * (hover.h + 0.5)}
                    y={hover.r * 30 - 4}
                    width={width}
                    title={`${rowLabels[hover.r]}, ${fmtHour(hover.h)} – ${fmtHour((hover.h + 1) % 24)}`}
                    rows={[{ label: 'entries in this hour, added up over the chosen days', value: fmtInt(grid[hover.r][hover.h]), color: SEQ_RAMP[seqIndex(max ? grid[hover.r][hover.h] / max : 0)], shape: 'rect' }]}
                />
            )}
        </div>
    );
};

// ---------- Cohort grid ----------

/** Return on day 1, 7, 14 and 30 by sign-up week. Values are already percentages; `scaleMax` is in points. */
export const CohortGrid: React.FC<{ rows: CohortRowModel[]; days: readonly number[]; scaleMax: number }> = ({ rows, days, scaleMax }) => (
    <div className="overflow-x-auto">
        <table className="w-full border-separate text-[13px]" style={{ borderSpacing: '2px' }}>
            <caption className="sr-only">Share of new sign-ups who saved an entry on day 1, 7, 14 and 30 after verifying their phone, by sign-up week</caption>
            <thead>
                <tr className="text-[12px] text-stone-500">
                    <th scope="col" className="pb-1.5 pr-3 text-left font-medium">Signed up week of</th>
                    <th scope="col" className="pb-1.5 pr-3 text-right font-medium">Sign-ups</th>
                    {days.map((d) => <th key={d} scope="col" className="pb-1.5 text-right font-medium">Day {d}</th>)}
                </tr>
            </thead>
            <tbody className="tabular-nums">
                {rows.map((row) => (
                    <tr key={row.weekStart}>
                        <th scope="row" className="whitespace-nowrap pr-3 text-left font-normal text-stone-700">{row.label}</th>
                        <td className="pr-3 text-right text-stone-600">{fmtInt(row.people)}</td>
                        {row.cells.map((v, k) => {
                            if (row.people === 0) {
                                return (
                                    <td key={k} className="rounded-[4px] bg-stone-50 px-3 py-2 text-right text-stone-500" title="No one signed up that week">
                                        nobody
                                    </td>
                                );
                            }
                            if (v === null) {
                                return (
                                    <td key={k} className="rounded-[4px] bg-stone-50 px-3 py-2 text-right text-stone-500" title="This week has not finished yet">
                                        not yet
                                    </td>
                                );
                            }
                            const idx = seqIndex(v / scaleMax);
                            return (
                                <td key={k} className="rounded-[4px] px-3 py-2 text-right font-medium" style={{ background: SEQ_RAMP[idx], color: SEQ_INK[idx] }}>
                                    {fmtPctPoints(v)}
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

// ---------- Part-to-whole bar ----------

export interface Part {
    key: string;
    label: string;
    value: number;
    color: string;
    detail?: string;
}

/** Each part's share is its count ÷ the sum of the parts shown. */
export const PartBar: React.FC<{ parts: Part[]; ariaLabel: string }> = ({ parts, ariaLabel }) => {
    const total = parts.reduce((s, p) => s + p.value, 0) || 1;
    return (
        <div>
            <div className="flex h-3.5 w-full gap-[2px]" role="img" aria-label={ariaLabel}>
                {parts.map((p, k) => (
                    <span
                        key={p.key}
                        className={cx('h-full', k === 0 && 'rounded-l-[4px]', k === parts.length - 1 && 'rounded-r-[4px]')}
                        style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
                        title={`${p.label}: ${fmtPct(p.value / total, 0)}`}
                    />
                ))}
            </div>
            <ul className="mt-3 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
                {parts.map((p) => (
                    <li key={p.key} className="flex items-center gap-2">
                        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
                        <span className="truncate text-stone-700">{p.label}</span>
                        <span className="ml-auto whitespace-nowrap tabular-nums text-stone-900">{fmtPct(p.value / total, 0)}</span>
                        {p.detail && <span className="whitespace-nowrap tabular-nums text-stone-500">{p.detail}</span>}
                    </li>
                ))}
            </ul>
        </div>
    );
};
