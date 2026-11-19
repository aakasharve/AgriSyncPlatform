/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — Engagement: what kinds of work the saved entries were, how often
 * an active farm saves entries, when in the week entries reach the server, which
 * parts of the app people use, and how owners, mukadams and workers split.
 */
import React from 'react';
import { LineChart } from './MisLineChart';
import { BarTable, Heatmap, PartBar, ScaleLegend, type BarRow } from './MisSmallCharts';
import { ChartBody, ChartCard, DataTable, ItemLines, Row, compareLegend, itemAttrs, seriesTable, withPrevious, type MisSectionProps } from './MisUi';
import { OTHER, SERIES } from './misTheme';
import { fmtDec, fmtHour, fmtInt } from './misFormat';
import { WEEKDAY_SHORT, type EngagementView } from './misView';

const ROLE_COLORS = [SERIES.s1, SERIES.s2, SERIES.s3, SERIES.s4, SERIES.s5];
const dec = (v: number) => fmtDec(v, 1);
/* CR-2c E9: an entry with no task line, or with words not on the list, is "not recognised". */
const KINDS_NOTE = "Not recognised: the entry's work words are not on the app's list, or it has none.";

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
                    subtitle="Entries saved in this period, by kind of work"
                    footnote={view.kinds.kind === 'chart' ? KINDS_NOTE : undefined}
                >
                    <ChartBody chart={view.kinds} checkedAt={checkedAt}>
                        {(k) => (
                            <BarTable
                                rows={k.rows.map((r): BarRow => ({ key: r.key, label: r.label, value: r.entries, display: fmtInt(r.entries), color: SERIES.s1 }))}
                                caption="Saved entries by kind of work"
                                labelHeader="Kind of work"
                                valueHeader="Entries"
                                compare={false}
                            />
                        )}
                    </ChartBody>
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
                    subtitle="Share of the people counted here who used each part at least once in this period"
                >
                    <ChartBody chart={view.features} checkedAt={checkedAt}>
                        {(f) => (
                            <>
                                <BarTable
                                    rows={f.rows.map((r): BarRow => ({
                                        key: r.key,
                                        label: r.label,
                                        value: r.share ?? 0,
                                        display: r.shareText ?? r.word ?? '',
                                        extra: [r.people === null ? '' : fmtInt(r.people)],
                                        color: SERIES.s1,
                                    }))}
                                    caption="Share of people who used each part of the app"
                                    labelHeader="Part of the app"
                                    valueHeader="Share"
                                    extraHeaders={['People']}
                                    compare={false}
                                    max={100}
                                />
                                {f.rows.filter((r) => r.why !== null).map((r) => (
                                    <p key={r.key} className="mt-2 text-[12px] leading-snug text-stone-500">{r.label}: {r.why}</p>
                                ))}
                            </>
                        )}
                    </ChartBody>
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
                    <div className="mt-5" {...itemAttrs('engagement.featureByRole')}>
                        <p className="text-[13px] font-medium text-stone-800">Feature use by role</p>
                        <ItemLines item="engagement.featureByRole" className="mt-1" />
                        <div className="mt-2">
                            <ChartBody chart={view.featureRoles} checkedAt={checkedAt}>
                                {(t) => (
                                    <DataTable
                                        table={{
                                            columns: ['Part of the app', ...t.roles.map((role) => role.label)],
                                            rows: t.rows.map((row) => [row.label, ...row.cells.map((c) => (c === null ? 'nobody' : fmtInt(c)))]),
                                        }}
                                    />
                                )}
                            </ChartBody>
                        </div>
                    </div>
                </ChartCard>
            </Row>
        </div>
    );
};
