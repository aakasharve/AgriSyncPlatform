// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1, item 11 (founder D-71); fix pass 2 (N-1).
//
// His erasure requests and what the last cancel did, drawn from `useMyErasureRequests` (which the screen owns, so it can
// also show his waiting request in place of a new "erase" button). A waiting one shows the day erasure starts and
// "विनंती रद्द करा".

import React from 'react';
import { tDataRights, type DataRightsLocale } from '../../i18n/dataRightsTranslations';
import RecentRequestsList from './RecentRequestsList';
import type { MyErasureRequests as Requests } from './useMyErasureRequests';

interface Props {
    locale: DataRightsLocale;
    requests: Requests;
}

const MyErasureRequests: React.FC<Props> = ({ locale, requests }) => (
    <div className="space-y-2" data-testid="my-erasure-requests">
        {requests.notice && (
            <p
                className={`text-sm font-bold ${requests.notice === 'cancelDone' ? 'text-emerald-800' : 'text-red-700'}`}
                role="status"
                data-testid={`erasure-notice-${requests.notice}`}
            >
                {tDataRights(locale, `recent.${requests.notice}`)}
            </p>
        )}
        {requests.rows && (
            <RecentRequestsList
                requests={requests.rows}
                locale={locale}
                onCancel={id => { void requests.cancel(id); }}
                cancellingId={requests.cancellingId}
            />
        )}
    </div>
);

export default MyErasureRequests;
