/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — Acquisition: how far new sign-ups get (funnel), and the install,
 * channel and district boxes, which need sources outside the app and say why.
 */
import React from 'react';
import { Funnel } from './MisSmallCharts';
import { ChartCard, ItemLines, NotMeasuredYet, Row, type MisSectionProps } from './MisUi';
import { itemByKey } from './misItems';
import type { AcquisitionView } from './misView';

const why = (key: string) => itemByKey(key).why ?? '';

export const AcquisitionSection: React.FC<MisSectionProps<AcquisitionView>> = ({ view, compare }) => (
    <div className="space-y-5">
        <Row>
            <ChartCard
                item="acquisition.verified"
                fields={['acquisition.verified']}
                className="col-span-12 xl:col-span-7"
                title="From install to habit"
                subtitle="How far people who verified their phone in this range got. Percentages are of sign-ups; the habit is of those 7 days in."
                table={{
                    columns: ['Step', 'People', 'Share'],
                    rows: view.steps.map((s) => [
                        s.label,
                        s.pending ?? (s.current.kind === 'value' ? s.current.text : 'not measured'),
                        s.share ? `${s.share.text} ${s.share.of}` : '',
                    ]),
                }}
            >
                <Funnel steps={view.steps} compare={compare} />
            </ChartCard>
            <ChartCard
                item="acquisition.installsPerDay"
                className="col-span-12 xl:col-span-5"
                title="Installs per day"
                subtitle="Play Store installs"
            >
                <NotMeasuredYet why={why('acquisition.installsPerDay')} />
            </ChartCard>
        </Row>
        <Row>
            <ChartCard
                item="acquisition.installsByChannel"
                className="col-span-12 xl:col-span-6"
                title="Installs by channel"
                subtitle="Per week"
            >
                <NotMeasuredYet why={why('acquisition.installsByChannel')} />
            </ChartCard>
            <ChartCard
                item="acquisition.channelVerify"
                className="col-span-12 xl:col-span-6"
                title="Which channels bring farmers who stay"
                subtitle="Habit = saved entries on 3 of their first 7 days"
            >
                <NotMeasuredYet why={why('acquisition.channelVerify')} />
                <div className="mt-3 text-[12px] text-stone-500" data-mis-item="acquisition.channelHabit" data-mis-fields="">
                    Habit by channel is not measured yet either. {why('acquisition.channelHabit')}
                    <ItemLines item="acquisition.channelHabit" className="mt-1.5" />
                </div>
            </ChartCard>
        </Row>
        <ChartCard
            item="acquisition.installsByDistrict"
            title="Installs by district"
            subtitle="Open a district to see its talukas"
        >
            <NotMeasuredYet why={why('acquisition.installsByDistrict')} />
        </ChartCard>
    </div>
);
