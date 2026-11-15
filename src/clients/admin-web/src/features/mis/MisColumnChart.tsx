/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — column chart (inline SVG), stacked or grouped. Columns are capped at
 * 24px, grow from one baseline, have a 4px rounded top and a 2px surface gap between stacked
 * segments. Each column is its own hover / focus target with a readout of every series.
 */
import React, { useState } from 'react';
import { CHROME } from './misTheme';
import { ChartTooltip, labelIndices, niceTicks, useMeasuredWidth, type TooltipRow } from './MisUi';

export interface ColumnSeries {
    key: string;
    label: string;
    color: string;
    values: number[];
}

interface Props {
    labels: string[];
    titles?: string[];
    series: ColumnSeries[];
    yFormat: (v: number) => string;
    /** Value format in the tooltip (defaults to yFormat). */
    valueFormat?: (v: number) => string;
    ariaLabel: string;
    mode?: 'stacked' | 'grouped';
    height?: number;
    /** Fixed top of the scale, e.g. 1 for 100%-stacked shares. */
    yMax?: number;
    /** Show a "Total" line in the tooltip (stacked counts). */
    showTotal?: boolean;
}

const M = { top: 10, right: 12, bottom: 26, left: 48 };
const GAP = 2;

/** Rect with only the top corners rounded (data end), square at the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
    const rr = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + h}L${x},${y + rr}Q${x},${y} ${x + rr},${y}L${x + w - rr},${y}Q${x + w},${y} ${x + w},${y + rr}L${x + w},${y + h}Z`;
}

export const ColumnChart: React.FC<Props> = ({
    labels, titles, series, yFormat, valueFormat, ariaLabel, mode = 'stacked', height = 220, yMax, showTotal,
}) => {
    const [ref, width] = useMeasuredWidth<HTMLDivElement>();
    const [hover, setHover] = useState<number | null>(null);
    const n = labels.length;
    const plotW = Math.max(40, width - M.left - M.right);
    const plotH = height - M.top - M.bottom;
    const band = plotW / Math.max(1, n);
    const fmtV = valueFormat ?? yFormat;

    const totals = labels.map((_, i) => series.reduce((s, se) => s + (se.values[i] ?? 0), 0));
    const peak = mode === 'stacked' ? Math.max(0, ...totals) : Math.max(0, ...series.flatMap((s) => s.values));
    const ticks = niceTicks(0, yMax ?? (peak || 1), 4);
    const hi = yMax ?? ticks[ticks.length - 1];
    const y = (v: number) => M.top + (1 - v / (hi || 1)) * plotH;
    const base = y(0);
    const xIdx = labelIndices(n, plotW, 64);

    const barW = mode === 'stacked'
        ? Math.max(2, Math.min(24, band * 0.68))
        : Math.max(2, Math.min(14, (band * 0.76 - GAP * (series.length - 1)) / series.length));
    const groupW = mode === 'stacked' ? barW : barW * series.length + GAP * (series.length - 1);

    const onKey = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            setHover((h) => Math.max(0, Math.min(n - 1, (h ?? n - 1) + (e.key === 'ArrowRight' ? 1 : -1))));
        } else if (e.key === 'Escape') setHover(null);
    };

    // Stacked: list top segment first, as the eye reads the column. Grouped: left to right.
    const tipOrder = mode === 'stacked' ? [...series].reverse() : series;
    const tipRows: TooltipRow[] = hover === null ? [] : tipOrder.map((s) => ({
        label: s.label, value: fmtV(s.values[hover] ?? 0), color: s.color, shape: 'rect' as const,
    }));

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
                onPointerLeave={() => setHover(null)}
                className="block overflow-visible rounded-md"
            >
                {ticks.map((t) => (
                    <g key={t}>
                        <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? CHROME.axis : CHROME.grid} strokeWidth={1} shapeRendering="crispEdges" />
                        <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHROME.tick} style={{ fontVariantNumeric: 'tabular-nums' }}>{yFormat(t)}</text>
                    </g>
                ))}
                {xIdx.map((i) => (
                    <text key={i} x={M.left + band * (i + 0.5)} y={height - 6} textAnchor="middle" fontSize={11} fill={CHROME.tick}>{labels[i]}</text>
                ))}
                {labels.map((_, i) => {
                    const cx0 = M.left + band * (i + 0.5) - groupW / 2;
                    const dim = hover !== null && hover !== i;
                    const shapes: React.ReactNode[] = [];
                    if (mode === 'stacked') {
                        let acc = 0;
                        const visible = series.map((s) => s.values[i] ?? 0).map((v, k) => ({ v, k })).filter((e) => e.v > 0);
                        visible.forEach((e, idx) => {
                            const y0 = y(acc);
                            acc += e.v;
                            const y1 = y(acc);
                            const h = y0 - y1 - (idx > 0 ? GAP : 0);
                            if (h <= 0.5) return;
                            const isTop = idx === visible.length - 1;
                            const color = series[e.k].color;
                            shapes.push(isTop
                                ? <path key={e.k} d={topRounded(cx0, y1, barW, h, 4)} fill={color} />
                                : <rect key={e.k} x={cx0} y={y1} width={barW} height={h} fill={color} />);
                        });
                    } else {
                        series.forEach((s, k) => {
                            const v = s.values[i] ?? 0;
                            const h = base - y(v);
                            if (h <= 0.5) return;
                            shapes.push(<path key={k} d={topRounded(cx0 + k * (barW + GAP), y(v), barW, h, 3)} fill={s.color} />);
                        });
                    }
                    return (
                        <g key={i} opacity={dim ? 0.45 : 1} style={{ transition: 'opacity 120ms' }}>
                            {shapes}
                            <rect
                                x={M.left + band * i}
                                y={M.top}
                                width={band}
                                height={plotH}
                                fill="transparent"
                                onPointerEnter={() => setHover(i)}
                                onPointerMove={() => setHover(i)}
                            />
                        </g>
                    );
                })}
            </svg>
            {hover !== null && (
                <ChartTooltip
                    x={M.left + band * (hover + 0.5) + groupW / 2}
                    y={M.top}
                    width={width}
                    title={titles?.[hover] ?? labels[hover]}
                    rows={tipRows}
                    footer={showTotal && series.length > 1 ? `Total ${fmtV(totals[hover])}` : undefined}
                />
            )}
        </div>
    );
};
