/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — Farms & geography: active and registered farms, the land they
 * cover, the crops on them and the producer organisations they belong to.
 * Districts and talukas are not counted yet and say what blocks them.
 */
import React from 'react';
import { LineChart } from './MisLineChart';
import { BarTable, type BarRow } from './MisSmallCharts';
import { ChartBody, ChartCard, KpiStrip, NotMeasuredYet, Row, seriesTable, type MisSectionProps } from './MisUi';
import { SERIES } from './misTheme';
import { MIS_SLOTS, itemByKey } from './misItems';
import { fmtCompact, fmtDec, fmtInt } from './misFormat';
import type { FarmsView } from './misView';

const why = (key: string) => itemByKey(key).why ?? '';
const acresFmt = (v: number) => fmtDec(v, 1);
const NOT_IN_FPO = MIS_SLOTS.find((s) => s.key === 'farms.perFpo.notInFpo');

export const FarmsSection: React.FC<MisSectionProps<FarmsView>> = ({ view, compare, checkedAt }) => (
    <div className="space-y-5">
        <KpiStrip tiles={view.tiles} compare={compare} columns="grid-cols-2 lg:grid-cols-4" />
        <Row>
            <ChartCard
                item="farms.byDistrict"
                className="col-span-12 xl:col-span-7"
                title="Active farms by district"
                subtitle="Farms that saved an entry in the last 7 days. Open a district to see its talukas."
            >
                <NotMeasuredYet why={why('farms.byDistrict')} />
            </ChartCard>
            <ChartCard
                item="farms.crops"
                className="col-span-12 xl:col-span-5"
                title="Crops on active farms"
                subtitle="Every crop being grown on an active farm, by the name entered"
            >
                <ChartBody chart={view.crops} checkedAt={checkedAt}>
                    {(c) => (
                        <BarTable
                            rows={c.rows.map((r): BarRow => ({
                                key: r.key,
                                label: r.label,
                                value: r.farms,
                                display: fmtInt(r.farms),
                                extra: [acresFmt(r.acres)],
                                color: SERIES.s1,
                            }))}
                            caption="Crops on active farms, with their farms and plot acres"
                            labelHeader="Crop"
                            valueHeader="Farms"
                            extraHeaders={['Acres']}
                            compare={false}
                        />
                    )}
                </ChartBody>
            </ChartCard>
        </Row>
        <Row>
            <ChartCard
                item="farms.perFpo"
                className="col-span-12 xl:col-span-7"
                title="Farms per producer organisation"
                subtitle="Registered farms linked to each farmer producer organisation, most farms first"
                footnote={NOT_IN_FPO && (
                    <span data-mis-item={NOT_IN_FPO.key} data-mis-fields="">{NOT_IN_FPO.why}</span>
                )}
            >
                <ChartBody chart={view.perFpo} checkedAt={checkedAt}>
                    {(p) => (
                        <BarTable
                            rows={p.rows.map((r): BarRow => ({ key: r.key, label: r.label, value: r.farms, display: fmtInt(r.farms), color: SERIES.s1 }))}
                            caption="Registered farms per producer organisation"
                            labelHeader="Producer organisation"
                            valueHeader="Farms"
                            compare={false}
                        />
                    )}
                </ChartBody>
            </ChartCard>
            <ChartCard
                item="farms.acresChart"
                className="col-span-12 xl:col-span-5"
                title="Acres covered"
                subtitle="Land under farms active in the trailing 7 days, once a week (today's plot sizes)"
                table={view.acres.kind === 'chart'
                    ? seriesTable('Day', view.acres.data.titles, [{ name: 'Acres', values: view.acres.data.values, fmt: acresFmt }])
                    : undefined}
            >
                <ChartBody chart={view.acres} checkedAt={checkedAt}>
                    {(a) => (
                        <LineChart
                            labels={a.labels}
                            height={260}
                            ariaLabel="Acres under active farms, once a week"
                            yFormat={fmtCompact}
                            titleAt={(i) => a.titles[i]}
                            series={[{ key: 'cur', label: 'Acres', color: SERIES.s1, values: a.values, area: true }]}
                        />
                    )}
                </ChartBody>
            </ChartCard>
        </Row>
    </div>
);
