/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AccessStatusNotice — what a person's seat on a farm IS, said at the top of the app, from the
 * server (`/me/context`, asked with includePending): a request still waiting for the owner
 * ("मंजुरीची वाट") or a paused seat ("काम थांबवलं — कारण…", the owner's own words).
 *
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, AC2 / MU-6). Why it is needed: the phone lists and
 * opens only Active farms (`isActiveSeat`), so a paused farm simply vanished from the farm switch
 * with no word of why — and a waiting request was visible only on the 0-farm screen and the profile.
 * Nothing here is a button: a request is withdrawn from the profile, a pause is the owner's to lift.
 *
 * Mount: under MeAlertRail (AppContent.tsx). Server-decided; the phone computes nothing.
 */
import React from 'react';
import { Clock3, PauseCircle } from 'lucide-react';
import { useFarmContext } from '../../../core/session/FarmContext';
import type { MeFarm } from '../../../core/session/MeContextService';
import { isActiveSeat } from '../../../core/session/seatStatus';
import { JOIN_BY_CODE_COPY } from '../../onboarding/components/JoinByCodeScreen';
import { SANS } from '../../../shared/components/ui/placeUi';

/** The lane brief's words ("मंजुरीची वाट" / "काम थांबवलं — कारण…"); the joining "{farm}: …" and the
 *  "कारण: {reason}" form are PROPOSED (Marathi). */
export const ACCESS_STATUS_COPY = {
    waiting: 'मंजुरीची वाट',
    paused: 'काम थांबवलं',
    pausedWithReason: (reason: string) => `काम थांबवलं — कारण: ${reason}`, // PROPOSED (Marathi) — the "कारण:" form
    talkToOwner: JOIN_BY_CODE_COPY.pausedLine,
} as const;

/** The one line for a seat that is not Active (exported for the tests). */
export function accessStatusLine(farm: Pick<MeFarm, 'name' | 'status' | 'statusReason'>): string {
    if (farm.status === 'Suspended') {
        const reason = farm.statusReason?.trim();
        return `${farm.name}: ${reason ? ACCESS_STATUS_COPY.pausedWithReason(reason) : ACCESS_STATUS_COPY.paused}. ${ACCESS_STATUS_COPY.talkToOwner}`;
    }
    return `${farm.name}: ${ACCESS_STATUS_COPY.waiting}`;
}

const AccessStatusNotice: React.FC = () => {
    const { meContext } = useFarmContext();
    const seats = (meContext?.farms ?? []).filter(f => !isActiveSeat(f));
    if (seats.length === 0) return null;

    return (
        <div className="space-y-1.5 px-4 pt-2" data-testid="access-status-notice" style={{ fontFamily: SANS }}>
            {seats.map(farm => {
                const paused = farm.status === 'Suspended';
                const Icon = paused ? PauseCircle : Clock3;
                return (
                    <p key={farm.farmId} role="status" data-testid={`access-status-${farm.farmId}`} data-kind={paused ? 'paused' : 'waiting'}
                        className={`m-0 flex items-start gap-2 rounded-2xl border px-3 py-2 text-[14px] font-bold leading-snug ${paused ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
                        <Icon size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span>{accessStatusLine(farm)}</span>
                    </p>
                );
            })}
        </div>
    );
};

export default AccessStatusNotice;
