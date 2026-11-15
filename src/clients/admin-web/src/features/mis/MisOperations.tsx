/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — Operations: OTP / SMS delivery and the farmer support queue.
 * Nothing on this page is measured yet: the SMS provider's delivery reports
 * are not connected and there is no support tool. Every box says so.
 */
import React from 'react';
import { ChartCard, KpiStrip, NotMeasuredYet, Row, type MisSectionProps } from './MisUi';
import { itemByKey } from './misItems';
import type { OperationsView } from './misView';

const why = (key: string) => itemByKey(key).why ?? '';

export const OperationsSection: React.FC<MisSectionProps<OperationsView>> = ({ view, compare }) => (
    <div className="space-y-5">
        <KpiStrip tiles={view.tiles} compare={compare} />
        <Row>
            <ChartCard
                item="operations.otpChart"
                className="col-span-12 xl:col-span-7"
                title="OTP texts delivered"
                subtitle="Share of sign-in codes that reached the phone"
            >
                <NotMeasuredYet why={why('operations.otpChart')} />
            </ChartCard>
            <ChartCard
                item="operations.otpFailReasons"
                className="col-span-12 xl:col-span-5"
                title="Why OTP texts failed"
                subtitle="Undelivered codes in this range, by reason"
            >
                <NotMeasuredYet why={why('operations.otpFailReasons')} />
            </ChartCard>
        </Row>
        <Row>
            <ChartCard
                item="operations.ticketsChart"
                className="col-span-12 xl:col-span-7"
                title="Support tickets opened and closed"
                subtitle="Per week"
            >
                <NotMeasuredYet why={why('operations.ticketsChart')} />
            </ChartCard>
            <ChartCard
                item="operations.topIssues"
                className="col-span-12 xl:col-span-5"
                title="Top issues farmers raised"
                subtitle="Tickets opened in this range, by topic"
            >
                <NotMeasuredYet why={why('operations.topIssues')} />
            </ChartCard>
        </Row>
    </div>
);
