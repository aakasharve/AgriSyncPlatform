/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — Engagement: how often an active farm saves entries, when in the
 * week entries reach the server, and how owners, mukadams and workers split.
 * Entry types and feature use are not counted yet and say why.
 */
import React from 'react';
import { LineChart } from './MisLineChart';
import { Heatmap, PartBar, ScaleLegend } from './MisSmallCharts';
import { ChartBody, ChartCard, ItemLines, NotMeasuredYet, Row, compareLegend, seriesTable, withPrevious, type MisSectionProps } from './MisUi';
import { OTHER, SERIES } from './misTheme';
import { itemByKey } from './misItems';
import { fmtDec, fmtHour, fmtInt } from './misFormat';
import { WEEKDAY_SHORT, type EngagementView } from './misView';

const ROLE_COLORS = [SERIES.s1, SERIES.s2, SERIES.s3, SERIES.s4, SERIES.s5];
const why = (key: string) => itemByKey(key).why ?? '';
const dec = (v: number) => fmtDec(v, 1);

export const EngagementSection: React.FC<MisSectionProps<EngagementView>> = ({ view, compare, checkedAt }) => {
    const perFarm = view.perFarm;
    const showPrev = compare && perFarm.kind === 'chart' && perFarm.data.previous !== null;
    return (
        <div className="space-y-5">
            <Row>
                <ChartCard
                    item="engagement.logsByType"
                    className="col-span-12 xl:col-span-8"
                    title="Entries by type"
                    subtitle="Per week, what the saved entries were about"
                >
                    <NotMeasuredYet why={why('engagement.logsByType')} />
                </ChartCard>
                <ChartCard
                    item="engagement.logsPerFarm"
                    className="col-span-12 xl:col-span-4"
                    title="Entries per active farm, per week"
                    subtitle="Last 7 days of entries ÷ farms active in them"
                    legend={compareLegend(SERIES.s1, 'This period', showPrev)}
                    table={perFarm.kind === 'chart'
                        ? seriesTable('Day', perFarm.data.titles, [
                            { name: 'Entries per farm', values: perFarm.data.current, fmt: dec, empty: 'not measured' },
                            ...(showPrev && perFarm.data.previous ? [{ name: 'Previous period', values: perFarm.data.previous, fmt: dec, empty: 'not measured' }] : []),
                        ])
                        : undefined}
                >
                    <ChartBody chart={perFarm} checkedAt={checkedAt}>
                        {(line) => (
                            <LineChart
                                labels={line.labels}
                                height={260}
                                ariaLabel="Entries per active farm per week, each day"
                                yFormat={dec}
                                titleAt={(i) => line.titles[i]}
                                series={withPrevious({ key: 'cur', label: 'Entries per farm', color: SERIES.s1, values: line.current }, line.previous, compare)}
                            />
                        )}
                    </ChartBody>
                </ChartCard>
            </Row>

            <ChartCard
                item="engagement.whenLogged"
                title="When farmers log"
                subtitle="Times are when an entry reached the server; an entry saved without signal counts when the phone next connected."
                action={<span className="hidden md:block"><ScaleLegend low="Fewer" high="More entries" /></span>}
                footnote="Each square is the entries in that hour, added up over the chosen days."
                table={view.heat.kind === 'chart'
                    ? {
                        columns: ['Day', ...Array.from({ length: 24 }, (_, h) => fmtHour(h))],
                        rows: view.heat.data.grid.map((row, r) => [WEEKDAY_SHORT[r], ...row.map((v) => fmtInt(v))]),
                    }
                    : undefined}
            >
                <ChartBody chart={view.heat} checkedAt={checkedAt}>
                    {(h) => <Heatmap grid={h.grid} max={h.max} rowLabels={WEEKDAY_SHORT} ariaLabel="Entries by hour of day and day of week" />}
                </ChartBody>
            </ChartCard>

            <Row>
                <ChartCard
                    item="engagement.featureUse"
                    className="col-span-12 xl:col-span-5"
                    title="Feature use"
                    subtitle="Share of active people who used it at least once in the range"
                >
                    <NotMeasuredYet why={why('engagement.featureUse')} />
                </ChartCard>
                <ChartCard
                    item="engagement.roleMix"
                    className="col-span-12 xl:col-span-7"
                    title="Who uses ShramSafal, and for what"
                    subtitle="Monthly active people by their role on the farm where they saved most entries"
                >
                    <ChartBody chart={view.roles} checkedAt={checkedAt}>
                        {(r) => (
                            <PartBar
                                ariaLabel="Monthly active people by role"
                                parts={r.parts.map((p, k) => ({
                                    key: p.key,
                                    label: p.label,
                                    value: p.people,
                                    color: ROLE_COLORS[k] ?? OTHER,
                                    detail: `${fmtInt(p.people)} ${p.people === 1 ? "person" : "people"}`,
                                    share: p.share,
                                }))}
                            />
                        )}
                    </ChartBody>
                    <div className="mt-5" data-mis-item="engagement.featureByRole" data-mis-fields="">
                        <p className="text-[13px] font-medium text-stone-800">Feature use by role</p>
                        <ItemLines item="engagement.featureByRole" className="mt-1" />
                        <div className="mt-2"><NotMeasuredYet why={why('engagement.featureByRole')} /></div>
                    </div>
                </ChartCard>
            </Row>
        </div>
    );
};
