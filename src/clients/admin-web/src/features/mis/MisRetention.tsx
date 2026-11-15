/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — Retention: who comes back (cohort grid and return curve, by
 * sign-up week) and the early-warning view of farms going quiet, so the field
 * team knows whom to call.
 */
import React from 'react';
import { LineChart } from './MisLineChart';
import { CohortGrid, PartBar, ScaleLegend } from './MisSmallCharts';
import { ChartBody, ChartCard, Delta, KpiStrip, NotMeasuredYet, Row, compareLegend, seriesTable, withPrevious, type MisSectionProps } from './MisUi';
import { SERIES, STATUS } from './misTheme';
import { itemByKey } from './misItems';
import { fmtCompact, fmtInt, fmtPctPoints } from './misFormat';
import { COHORT_DAYS, type RetentionView } from './misView';

const BAND_COLORS = [SERIES.s1, '#78716c', '#a8a29e', '#d6d3d1', '#ece9e6'];
const pts = (v: number) => fmtPctPoints(v);

export const RetentionSection: React.FC<MisSectionProps<RetentionView>> = ({ view, compare, checkedAt }) => {
    const curve = view.curve;
    const curvePrev = compare && curve.kind === 'chart' && curve.data.previous !== null;
    const win = view.winBack;
    const winPrev = compare && win.kind === 'chart' && win.data.previous !== null;
    return (
        <div className="space-y-5">
            <KpiStrip tiles={view.tiles} compare={compare} columns="grid-cols-2 lg:grid-cols-4" />
            <Row>
                <ChartCard
                    item="retention.cohorts"
                    className="col-span-12 xl:col-span-7"
                    title="Return by sign-up week"
                    subtitle="Share of new people who saved an entry on day 1, 7, 14 and 30, by sign-up week (phone verified), not install"
                    action={<span className="hidden md:block"><ScaleLegend low="0%" high="60%" /></span>}
                    footnote="'not yet' means that day has not come for those sign-ups; 'nobody' means no one signed up that week."
                >
                    <ChartBody chart={view.cohorts} checkedAt={checkedAt}>
                        {(c) => <CohortGrid rows={c.rows} days={COHORT_DAYS} scaleMax={60} />}
                    </ChartBody>
                </ChartCard>
                <ChartCard
                    item="retention.curve"
                    className="col-span-12 xl:col-span-5"
                    title="Return curve"
                    subtitle="Share of new people who saved an entry on each day after signing up, by sign-up week (phone verified), not install"
                    legend={compareLegend(SERIES.s1, 'Signed up this period', curvePrev)}
                    table={curve.kind === 'chart'
                        ? seriesTable('Day after signing up', curve.data.labels, [
                            { name: 'This period', values: curve.data.current, fmt: pts },
                            ...(curvePrev && curve.data.previous ? [{ name: 'Previous period', values: curve.data.previous, fmt: pts }] : []),
                        ])
                        : undefined}
                    footnote="Later days fill in as recent sign-ups get older."
                >
                    <ChartBody chart={curve} checkedAt={checkedAt}>
                        {(c) => (
                            <LineChart
                                labels={c.labels}
                                height={260}
                                ariaLabel="Return curve, day 0 to day 30"
                                yFormat={(v) => fmtPctPoints(v, 0)}
                                yMin={0}
                                yMax={100}
                                titleAt={(i) => c.titles[i]}
                                series={withPrevious({ key: 'cur', label: 'Signed up this period', color: SERIES.s1, values: c.current }, c.previous, compare)}
                            />
                        )}
                    </ChartBody>
                </ChartCard>
            </Row>
            <Row>
                <ChartCard
                    item="retention.bands"
                    className="col-span-12 xl:col-span-5"
                    title="Where every registered farm stands"
                    subtitle={view.bands.kind === 'chart' ? `On ${view.bands.data.asOf}, by days since the farm last saved an entry` : 'By days since the farm last saved an entry'}
                    table={view.bands.kind === 'chart'
                        ? { columns: ['Status', 'Farms'], rows: view.bands.data.parts.map((b) => [b.label, b.text]) }
                        : undefined}
                >
                    <ChartBody chart={view.bands} checkedAt={checkedAt}>
                        {(b) => (
                            <>
                                <PartBar
                                    ariaLabel="Registered farms by days since the last entry"
                                    parts={b.parts.map((p, k) => ({ key: p.key, label: p.label, value: p.value, color: BAND_COLORS[k], detail: p.text, share: p.share }))}
                                />
                                {compare && (
                                    <ul className="mt-4 space-y-1.5 border-t border-stone-100 pt-3 text-[13px]">
                                        {b.parts.slice(1).map((p) => (
                                            <li key={p.key} className="flex items-center justify-between gap-3">
                                                <span className="text-stone-600">{p.label}, change</span>
                                                <Delta delta={p.delta} />
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        )}
                    </ChartBody>
                </ChartCard>
                <ChartCard
                    item="retention.quietByDistrict"
                    className="col-span-12 xl:col-span-7"
                    title="Where farms are going quiet"
                    subtitle="Farms silent for 7–29 days, as a share of each district's farms"
                >
                    <NotMeasuredYet why={itemByKey('retention.quietByDistrict').why ?? ''} />
                </ChartCard>
            </Row>
            <ChartCard
                item="retention.winBack"
                title="Farms that can still be won back"
                subtitle="Silent for 7–29 days, each day of the range"
                legend={compareLegend(STATUS.serious, 'This period', winPrev)}
                table={win.kind === 'chart'
                    ? seriesTable('Day', win.data.titles, [
                        { name: 'Quiet farms', values: win.data.current, fmt: fmtInt, empty: 'not measured' },
                        ...(winPrev && win.data.previous ? [{ name: 'Previous period', values: win.data.previous, fmt: fmtInt, empty: 'not measured' }] : []),
                    ])
                    : undefined}
            >
                <ChartBody chart={win} checkedAt={checkedAt}>
                    {(w) => (
                        <LineChart
                            labels={w.labels}
                            ariaLabel="Farms silent 7 to 29 days, per day"
                            yFormat={fmtCompact}
                            titleAt={(i) => w.titles[i]}
                            series={withPrevious({ key: 'cur', label: 'Quiet farms', color: STATUS.serious, values: w.current }, w.previous, compare)}
                        />
                    )}
                </ChartBody>
            </ChartCard>
        </div>
    );
};
