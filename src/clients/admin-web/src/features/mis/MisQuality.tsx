/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — Quality: does voice work (recordings saved, speech service time,
 * corrections). Sync failures, crashes, the मला किती समजलं spread and version
 * adoption are not counted yet and say why.
 */
import React from 'react';
import { LineChart } from './MisLineChart';
import { ChartBody, ChartCard, KpiStrip, NotMeasuredYet, Row, compareLegend, seriesTable, withPrevious, type MisSectionProps } from './MisUi';
import { SERIES } from './misTheme';
import { itemByKey } from './misItems';
import { fmtDec, fmtMs, fmtPctPoints } from './misFormat';
import type { QualityView } from './misView';

const why = (key: string) => itemByKey(key).why ?? '';
const pts = (v: number) => fmtPctPoints(v);

export const QualitySection: React.FC<MisSectionProps<QualityView>> = ({ view, compare, checkedAt }) => {
    const saved = view.saved;
    const savedPrev = compare && saved.kind === 'chart' && saved.data.previous !== null;
    const corrected = view.corrected;
    const corrPrev = compare && corrected.kind === 'chart' && corrected.data.previous !== null;
    const latency = view.latency;
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
                    subtitle="How much of each voice entry the app understood, share of entries per band"
                >
                    <NotMeasuredYet why={why('quality.scoreSpread')} />
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
                    className="col-span-12 lg:col-span-6 xl:col-span-4"
                    title="Sync failures"
                    subtitle="Uploads that had to retry"
                >
                    <NotMeasuredYet why={why('quality.syncFailChart')} />
                </ChartCard>
                <ChartCard
                    item="quality.crashByVersion"
                    className="col-span-12 lg:col-span-6 xl:col-span-4"
                    title="Crashes by app version"
                    subtitle="Crashes per thousand sessions in this range"
                >
                    <NotMeasuredYet why={why('quality.crashByVersion')} />
                </ChartCard>
                <ChartCard
                    item="quality.versionAdoption"
                    className="col-span-12 xl:col-span-4"
                    title="App version adoption"
                    subtitle="Share of sessions on each version"
                >
                    <NotMeasuredYet why={why('quality.versionAdoption')} />
                </ChartCard>
            </Row>
        </div>
    );
};
