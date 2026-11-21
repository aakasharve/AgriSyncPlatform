/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — Overview: the one number the company runs on (farms that saved an
 * entry this week), then the headline tiles, then sign-ups and entries over the range.
 * Every figure comes from `OverviewView` (the company answer); nothing is made up here.
 */
import React from 'react';
import { LineChart } from './MisLineChart';
import { ColumnChart } from './MisColumnChart';
import { CARD, ChartBody, ChartCard, Delta, ItemLines, KpiStrip, Legend, Row, Shown, compareLegend, cx, itemAttrs, seriesTable, withPrevious, type MisSectionProps } from './MisUi';
import { SERIES } from './misTheme';
import { itemByKey } from './misItems';
import { fmtCompact, fmtInt } from './misFormat';
import type { OverviewView } from './misView';

export const OverviewSection: React.FC<MisSectionProps<OverviewView>> = ({ view, compare, checkedAt }) => {
    const { hero } = view;
    const installsWhy = itemByKey('overview.installsAndSignUps').why ?? '';
    return (
        <div className="space-y-5">
            <section className={cx(CARD, 'p-6')} aria-labelledby="mis-hero-label" {...itemAttrs(hero.item, hero.fields)}>
                <div className="grid gap-8 lg:grid-cols-[250px_minmax(0,1fr)]">
                    <div className="flex flex-col">
                        <h3 id="mis-hero-label" className="text-[15px] font-medium text-stone-900">Active farms</h3>
                        <p className="mt-0.5 text-[13px] text-stone-500" data-testid="mis-hero-as-of">As of {hero.asOf}</p>
                        <ItemLines item={hero.item} className="mt-1.5" />
                        <div className="mt-5 text-[56px] font-medium leading-none tracking-[-0.025em] text-stone-900" data-testid="kpi-activeFarms-value">
                            <Shown shown={hero.current} />
                        </div>
                        {hero.current.kind === 'notMeasured' && <p className="mt-2 text-[13px] text-stone-500">{hero.current.why}</p>}
                        {compare && hero.current.kind === 'value' && (
                            <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-[13px] text-stone-500">
                                <Delta delta={hero.delta} className="text-[13px]" />
                                {hero.previous.kind === 'value' && !hero.todaySoFar && <span>from {hero.previous.text} on {hero.previousTo}</span>}
                            </p>
                        )}
                        <dl className="mt-auto grid grid-cols-1 gap-2.5 border-t border-stone-100 pt-4 text-[13px] max-lg:mt-6">
                            <div className="flex justify-between gap-3"><dt className="text-stone-500">Farms registered</dt><dd className="tabular-nums text-stone-900"><Shown shown={hero.registered} /></dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-stone-500">Change in farms registered</dt><dd className="tabular-nums text-stone-900"><Shown shown={hero.newFarms} /></dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-stone-500">Acres under active farms</dt><dd className="tabular-nums text-stone-900"><Shown shown={hero.acres} /></dd></div>
                        </dl>
                    </div>
                    <div className="min-w-0">
                        <ChartBody chart={hero.line} checkedAt={checkedAt}>
                            {(line) => (
                                <>
                                    <div className="mb-3 flex h-4 justify-end">
                                        {compare && line.previous && <Legend items={compareLegend(SERIES.s1, 'This period', true)} />}
                                    </div>
                                    <LineChart
                                        labels={line.labels}
                                        height={250}
                                        ariaLabel="Active farms each day, counted over the trailing 7 days"
                                        yFormat={fmtCompact}
                                        titleAt={(i) => line.titles[i]}
                                        series={withPrevious({ key: 'cur', label: 'Active farms', color: SERIES.s1, values: line.current, area: true }, line.previous, compare)}
                                    />
                                </>
                            )}
                        </ChartBody>
                    </div>
                </div>
            </section>

            <KpiStrip tiles={view.tiles} compare={compare} columns="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" />

            <Row>
                <ChartCard
                    item="overview.installsAndSignUps"
                    className="col-span-12 xl:col-span-7"
                    title="Installs and sign-ups"
                    subtitle="Sign-ups are people who verified a phone number"
                    footnote={`Installs are not drawn. ${installsWhy}`}
                    table={view.signUps.kind === 'chart'
                        ? seriesTable('Day', view.signUps.data.titles, [{ name: 'Sign-ups', values: view.signUps.data.values, fmt: fmtInt }])
                        : undefined}
                >
                    <ChartBody chart={view.signUps} checkedAt={checkedAt}>
                        {(s) => (
                            <LineChart
                                labels={s.labels}
                                ariaLabel="Sign-ups per day"
                                yFormat={fmtCompact}
                                titleAt={(i) => s.titles[i]}
                                series={[{ key: 'signups', label: 'Sign-ups', color: SERIES.s2, values: s.values }]}
                            />
                        )}
                    </ChartBody>
                </ChartCard>
                <ChartCard
                    item="overview.logsByWeek"
                    className="col-span-12 xl:col-span-5"
                    title="Entries saved, voice and typed"
                    subtitle="Per week, every saved entry"
                    legend={view.logsByWeek.kind === 'chart' ? [{ label: 'Voice', color: SERIES.s1 }, { label: 'Typed', color: SERIES.s2 }] : undefined}
                    table={view.logsByWeek.kind === 'chart'
                        ? seriesTable('Week', view.logsByWeek.data.titles, [
                            { name: 'Voice', values: view.logsByWeek.data.voice, fmt: fmtInt },
                            { name: 'Typed', values: view.logsByWeek.data.typed, fmt: fmtInt },
                        ])
                        : undefined}
                >
                    <ChartBody chart={view.logsByWeek} checkedAt={checkedAt}>
                        {(w) => (
                            <ColumnChart
                                labels={w.labels}
                                titles={w.titles}
                                ariaLabel="Entries saved by voice and by typing, per week"
                                yFormat={fmtCompact}
                                valueFormat={fmtInt}
                                showTotal
                                series={[
                                    { key: 'voice', label: 'Voice', color: SERIES.s1, values: w.voice },
                                    { key: 'typed', label: 'Typed', color: SERIES.s2, values: w.typed },
                                ]}
                            />
                        )}
                    </ChartBody>
                </ChartCard>
            </Row>
        </div>
    );
};
