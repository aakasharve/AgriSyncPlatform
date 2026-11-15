/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — line chart (inline SVG). 2px lines, hairline grid, one y-axis,
 * an optional previous-period ghost line, a crosshair that snaps to the nearest day, and arrow-key
 * reading for keyboard users. Gaps (null) break the line instead of inventing a value.
 */
import React, { useState } from 'react';
import { CHROME, GHOST } from './misTheme';
import { ChartTooltip, labelIndices, niceTicks, useMeasuredWidth, type TooltipRow } from './MisUi';

export interface LineSeries {
    key: string;
    label: string;
    color: string;
    values: (number | null)[];
    /** Previous period: thin grey line, drawn underneath. */
    ghost?: boolean;
    /** Soft 10% wash under the line. */
    area?: boolean;
}

interface Props {
    labels: string[];
    series: LineSeries[];
    yFormat: (v: number) => string;
    ariaLabel: string;
    height?: number;
    yMin?: number;
    yMax?: number;
    /** Tooltip heading for index i (defaults to the x label). */
    titleAt?: (i: number) => string;
    /** Horizontal reference, e.g. a target. */
    refLine?: { value: number; label: string };
}

const M = { top: 10, right: 56, bottom: 26, left: 48 };

/** Runs of consecutive drawable indices (a null breaks the run). */
function runs(values: (number | null)[]): number[][] {
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

function pathOf(run: number[], values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
    return run.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(values[i] as number).toFixed(1)}`).join('');
}

export const LineChart: React.FC<Props> = ({ labels, series, yFormat, ariaLabel, height = 220, yMin, yMax, titleAt, refLine }) => {
    const [ref, width] = useMeasuredWidth<HTMLDivElement>();
    const [hover, setHover] = useState<number | null>(null);
    const n = labels.length;
    const plotW = Math.max(40, width - M.left - M.right);
    const plotH = height - M.top - M.bottom;

    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
    if (refLine) all.push(refLine.value);
    const dataMin = all.length ? Math.min(...all) : 0;
    const dataMax = all.length ? Math.max(...all) : 1;
    const ticks = niceTicks(yMin ?? Math.min(0, dataMin), yMax ?? (dataMax === dataMin ? dataMax + 1 : dataMax), 4);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const x = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;
    const xIdx = labelIndices(n, plotW, 70);

    const pick = (clientX: number, rect: DOMRect) => {
        const px = clientX - rect.left - M.left;
        const i = Math.round((px / plotW) * (n - 1));
        setHover(Math.max(0, Math.min(n - 1, i)));
    };

    const onKey = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            setHover((h) => {
                const base = h ?? n - 1;
                return Math.max(0, Math.min(n - 1, base + (e.key === 'ArrowRight' ? 1 : -1)));
            });
        } else if (e.key === 'Escape') setHover(null);
    };

    // Direct end labels for up to two live series, skipped when they would collide.
    const live = series.filter((s) => !s.ghost);
    const ends = live.map((s) => {
        let k = s.values.length - 1;
        while (k >= 0 && (s.values[k] === null || !Number.isFinite(s.values[k] as number))) k -= 1;
        return k >= 0 ? { s, k, v: s.values[k] as number } : null;
    }).filter((e): e is { s: LineSeries; k: number; v: number } => e !== null);
    const showEnds = ends.length > 0 && ends.length <= 2 && (ends.length < 2 || Math.abs(y(ends[0].v) - y(ends[1].v)) > 14);

    const tipRows: TooltipRow[] = hover === null ? [] : [...live, ...series.filter((s) => s.ghost)].map((s) => {
        const v = s.values[hover];
        return { label: s.label, value: v === null || v === undefined || !Number.isFinite(v) ? 'not measured' : yFormat(v), color: s.ghost ? GHOST : s.color };
    });

    return (
        <div ref={ref} className="relative w-full select-none" style={{ height }}>
            <svg
                width={width}
                height={height}
                role="img"
                aria-label={ariaLabel}
                tabIndex={0}
                onKeyDown={onKey}
                onFocus={() => setHover((h) => h ?? n - 1)}
                onBlur={() => setHover(null)}
                className="block overflow-visible rounded-md"
            >
                {ticks.map((t) => (
                    <g key={t}>
                        <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke={t === lo ? CHROME.axis : CHROME.grid} strokeWidth={1} shapeRendering="crispEdges" />
                        <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHROME.tick} style={{ fontVariantNumeric: 'tabular-nums' }}>{yFormat(t)}</text>
                    </g>
                ))}
                {xIdx.map((i) => (
                    <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'} fontSize={11} fill={CHROME.tick}>{labels[i]}</text>
                ))}
                {refLine && (
                    <g>
                        <line x1={M.left} x2={M.left + plotW} y1={y(refLine.value)} y2={y(refLine.value)} stroke="#a8a29e" strokeWidth={1} shapeRendering="crispEdges" />
                        <text x={M.left + plotW + 6} y={y(refLine.value)} dy="0.32em" fontSize={11} fill={CHROME.tick}>{refLine.label}</text>
                    </g>
                )}
                {series.filter((s) => s.ghost).map((s) => runs(s.values).map((run) => (
                    <path key={`${s.key}-${run[0]}`} d={pathOf(run, s.values, x, y)} fill="none" stroke={GHOST} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
                )))}
                {live.map((s) => (
                    <g key={s.key}>
                        {s.area && runs(s.values).map((run) => (
                            <path key={run[0]} d={`${pathOf(run, s.values, x, y)}L${x(run[run.length - 1]).toFixed(1)},${y(lo)}L${x(run[0]).toFixed(1)},${y(lo)}Z`} fill={s.color} opacity={0.1} />
                        ))}
                        {runs(s.values).map((run) => (
                            run.length === 1
                                ? <circle key={run[0]} cx={x(run[0])} cy={y(s.values[run[0]] as number)} r={2.5} fill={s.color} />
                                : <path key={run[0]} d={pathOf(run, s.values, x, y)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                        ))}
                    </g>
                ))}
                {showEnds && hover === null && ends.map((e) => (
                    <g key={e.s.key}>
                        <circle cx={x(e.k)} cy={y(e.v)} r={4} fill={e.s.color} stroke="#fff" strokeWidth={2} />
                        <text x={x(e.k) + 8} y={y(e.v)} dy="0.32em" fontSize={11} fontWeight={500} fill="#44403c" style={{ fontVariantNumeric: 'tabular-nums' }}>{yFormat(e.v)}</text>
                    </g>
                ))}
                {hover !== null && (
                    <g>
                        <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + plotH} stroke="#a8a29e" strokeWidth={1} shapeRendering="crispEdges" />
                        {series.map((s) => {
                            const v = s.values[hover];
                            if (v === null || v === undefined || !Number.isFinite(v)) return null;
                            return <circle key={s.key} cx={x(hover)} cy={y(v)} r={4} fill={s.ghost ? GHOST : s.color} stroke="#fff" strokeWidth={2} />;
                        })}
                    </g>
                )}
                <rect
                    x={M.left - 6}
                    y={M.top}
                    width={plotW + 12}
                    height={plotH}
                    fill="transparent"
                    onPointerMove={(e) => pick(e.clientX, (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect())}
                    onPointerLeave={() => setHover(null)}
                />
            </svg>
            {hover !== null && (
                <ChartTooltip x={x(hover)} y={M.top} width={width} title={titleAt ? titleAt(hover) : labels[hover]} rows={tipRows} />
            )}
        </div>
    );
};
