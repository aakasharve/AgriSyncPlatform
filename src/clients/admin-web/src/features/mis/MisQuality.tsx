/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — Quality: does voice work (recordings saved, speech service time,
 * corrections), how the मला किती समजलं scores spread, how many changes from
 * phones the server refused, and which app versions people are on. Crashes are
 * not counted yet and say why.
 */
import React from 'react';
import { LineChart } from './MisLineChart';
import { ColumnChart } from './MisColumnChart';
import { BarTable, type BarRow } from './MisSmallCharts';
import { ChartBody, ChartCard, ItemLines, KpiStrip, NotMeasuredYet, Row, compareLegend, seriesTable, withPrevious, type MisSectionProps } from './MisUi';
import { SERIES } from './misTheme';
import { itemByKey } from './misItems';
import { fmtCompact, fmtDec, fmtInt, fmtMs, fmtPctPoints } from './misFormat';
import { SYNC_EVERY_UPLOAD, SYNC_REFUSED_AGAIN, type QualityView } from './misView';

const why = (key: string) => itemByKey(key).why ?? '';
const pts = (v: number) => fmtPctPoints(v);

export const QualitySection: React.FC<MisSectionProps<QualityView>> = ({ view, compare, checkedAt }) => {
    const saved = view.saved;
    const savedPrev = compare && saved.kind === 'chart' && saved.data.previous !== null;
    const corrected = view.corrected;
    const corrPrev = compare && corrected.kind === 'chart' && corrected.data.previous !== null;
    const latency = view.latency;
    const spread = view.spread;
    const sync = view.sync;
    const syncNote = [SYNC_REFUSED_AGAIN, SYNC_EVERY_UPLOAD, sync.kind === 'chart' && sync.data.refusedWhy !== null ? `Refused changes are not measured: ${sync.data.refusedWhy}` : null]
        .filter((x): x is string => x !== null)
        .join(' ');
    return (
        <div className="space-y-5">
            <KpiStrip tiles={view.tiles} compare={compare} />
            <Row>
                <ChartCard
                    item="quality.voiceSaved"
                    className="col-span-12 xl:col-span-6"
                    title="Voice recordings saved"
                    subtitle="Share of recordings that became a saved entry, each day"
                    legend={compareLegend(SERIES.s1, 'This period', savedPrev)}
                    table={saved.kind === 'chart'
                        ? seriesTable('Day', saved.data.titles, [
                            { name: 'Saved', values: saved.data.current, fmt: pts, empty: 'not measured' },
                            ...(savedPrev && saved.data.previous ? [{ name: 'Previous period', values: saved.data.previous, fmt: pts, empty: 'not measured' }] : []),
                        ])
                        : undefined}
                >
                    <ChartBody chart={saved} checkedAt={checkedAt}>
                        {(line) => (
                            <LineChart
                                labels={line.labels}
                                ariaLabel="Share of voice recordings saved, per day"
                                yFormat={(v) => fmtPctPoints(v, 0)}
                                yMin={0}
                                yMax={100}
                                titleAt={(i) => line.titles[i]}
                                series={withPrevious({ key: 'cur', label: 'Saved', color: SERIES.s1, values: line.current }, line.previous, compare)}
                            />
                        )}
                    </ChartBody>
                </ChartCard>
                <ChartCard
                    item="quality.transcriptionAvg"
                    fields={['quality.transcriptionAvgMs', 'quality.transcriptionP95Ms']}
                    className="col-span-12 xl:col-span-6"
                    title="Speech service time"
                    subtitle="The speech service's own time, not the whole wait the farmer sees."
                    legend={latency.kind === 'chart' ? [{ label: 'Average', color: SERIES.s1, shape: 'line' }, { label: 'Slowest 5%', color: SERIES.s2, shape: 'line' }] : undefined}
                    table={latency.kind === 'chart'
                        ? seriesTable('Day', latency.data.titles, [
                            { name: 'Average', values: latency.data.avg, fmt: fmtMs, empty: 'not measured' },
                            { name: 'Slowest 5%', values: latency.data.p95, fmt: fmtMs, empty: 'not measured' },
                        ])
                        : undefined}
                >
                    <div data-mis-item="quality.transcriptionP95" data-mis-fields="quality.transcriptionP95Ms">
                        <ItemLines item="quality.transcriptionP95" className="mb-3" />
                        <ChartBody chart={latency} checkedAt={checkedAt}>
                            {(l) => (
                                <LineChart
                                    labels={l.labels}
                                    ariaLabel="Average and slowest 5% speech service time per day"
                                    yFormat={(v) => `${fmtDec(v / 1000, 1)} s`}
                                    titleAt={(i) => l.titles[i]}
                                    series={[
                                        { key: 'avg', label: 'Average', color: SERIES.s1, values: l.avg },
                                        { key: 'p95', label: 'Slowest 5%', color: SERIES.s2, values: l.p95 },
                                    ]}
                                />
                            )}
                        </ChartBody>
                    </div>
                </ChartCard>
            </Row>
            <Row>
                <ChartCard
                    item="quality.scoreSpread"
                    className="col-span-12 xl:col-span-6"
                    title="मला किती समजलं, score spread"
                    subtitle="Farm-days at each score in this period"
                    table={spread.kind === 'chart'
                        ? seriesTable('Score', spread.data.labels, [{ name: 'Farm-days', values: spread.data.values, fmt: fmtInt }])
                        : undefined}
                >
                    <ChartBody chart={spread} checkedAt={checkedAt}>
                        {(s) => (
                            <ColumnChart
                                labels={s.labels}
                                titles={s.titles}
                                ariaLabel="Farm-days at each understanding score"
                                yFormat={fmtCompact}
                                valueFormat={fmtInt}
                                series={[{ key: 'farmDays', label: 'Farm-days', color: SERIES.s1, values: s.values }]}
                            />
                        )}
                    </ChartBody>
                </ChartCard>
                <ChartCard
                    item="quality.corrected"
                    className="col-span-12 xl:col-span-6"
                    title="Entries corrected by farmers"
                    subtitle="Share of saved entries the farmer changed afterwards. Lower is better."
                    footnote="Counted only from the day the app version that records corrections went live."
                    legend={compareLegend(SERIES.s1, 'This period', corrPrev)}
                    table={corrected.kind === 'chart'
                        ? seriesTable('Day', corrected.data.titles, [
                            { name: 'Corrected', values: corrected.data.current, fmt: pts, empty: 'not measured' },
                            ...(corrPrev && corrected.data.previous ? [{ name: 'Previous period', values: corrected.data.previous, fmt: pts, empty: 'not measured' }] : []),
                        ])
                        : undefined}
                >
                    <ChartBody chart={corrected} checkedAt={checkedAt}>
                        {(line) => (
                            <LineChart
                                labels={line.labels}
                                ariaLabel="Share of entries corrected per day"
                                yFormat={(v) => fmtPctPoints(v, 0)}
                                yMin={0}
                                titleAt={(i) => line.titles[i]}
                                series={withPrevious({ key: 'cur', label: 'Corrected', color: SERIES.s1, values: line.current }, line.previous, compare)}
                            />
                        )}
                    </ChartBody>
                </ChartCard>
            </Row>
            <Row>
                <ChartCard
                    item="quality.syncFailChart"
                    className="col-span-12 xl:col-span-8"
                    title="Sync failures"
                    subtitle="Changes from phones, refused and accepted, each day"
                    legend={sync.kind === 'chart' ? [{ label: 'Refused', color: SERIES.s1, shape: 'line' }, { label: 'Accepted', color: SERIES.s2, shape: 'line' }] : undefined}
                    table={sync.kind === 'chart'
                        ? seriesTable('Day', sync.data.titles, [
                            { name: 'Refused', values: sync.data.refused, fmt: fmtInt, empty: 'not measured' },
                            { name: 'Accepted', values: sync.data.accepted, fmt: fmtInt, empty: 'not measured' },
                        ])
                        : undefined}
                    footnote={syncNote}
                >
                    <ChartBody chart={sync} checkedAt={checkedAt}>
                        {(s) => (
                            <LineChart
                                labels={s.labels}
                                ariaLabel="Changes from phones refused and accepted by the server, per day"
                                yFormat={fmtCompact}
                                yMin={0}
                                titleAt={(i) => s.titles[i]}
                                series={[
                                    { key: 'refused', label: 'Refused', color: SERIES.s1, values: s.refused },
                                    { key: 'accepted', label: 'Accepted', color: SERIES.s2, values: s.accepted },
                                ]}
                            />
                        )}
                    </ChartBody>
                </ChartCard>
                <ChartCard
                    item="quality.crashByVersion"
                    className="col-span-12 xl:col-span-4"
                    title="Crashes by app version"
                    subtitle="Crashes per thousand sessions in this range"
                >
                    <NotMeasuredYet why={why('quality.crashByVersion')} />
                </ChartCard>
            </Row>
            <Row>
                <ChartCard
                    item="quality.versionAdoption"
                    className="col-span-12"
                    title="App version adoption"
                    subtitle="People seen in this period, by the version each used last"
                    footnote={view.versionsKnownSince ?? undefined}
                >
                    <ChartBody chart={view.versions} checkedAt={checkedAt}>
                        {(v) => (
                            <BarTable
                                rows={v.rows.map((r): BarRow => ({
                                    key: r.key,
                                    label: r.version,
                                    value: r.share,
                                    display: r.shareText,
                                    extra: [r.seenOn, fmtInt(r.people)],
                                    color: SERIES.s1,
                                }))}
                                caption="People on each app version, the Android app and other ways apart"
                                labelHeader="Version"
                                valueHeader="Share"
                                extraHeaders={['Seen on', 'People']}
                                compare={false}
                                max={100}
                            />
                        )}
                    </ChartBody>
                </ChartCard>
            </Row>
        </div>
    );
};
