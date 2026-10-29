/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HeldWorkNotice — spec R-11 (c) (pre-launch repair, founder N-1: "Workers also need a plain
 * explanation if the farm's subscription affects their work … Stop treating subscription refusal
 * as a temporary network failure").
 *
 * ONE plain Marathi line, for the owner AND every worker, at the top of the app, when either:
 *   - this phone is HOLDING records OF THE OPEN FARM the server refused for its trial / plan
 *     (`useHeldWorkCount` — read from the queue, i.e. what actually happened; another farm's held
 *     records are not counted here), or
 *   - the open farm's own snapshot says new work is not allowed right now
 *     (`evaluateEntitlement`, which folds in a server-managed access extension).
 * It says the work is safe on the phone and will go by itself — which is true: held rows are kept,
 * never charged, and re-sent with their own ids once the server allows the farm again.
 *
 * Nothing here is a button. No snapshot (an older server, or a farm with none) is never read as
 * "blocked" — only the server's real refusals or its real snapshot speak.
 *
 * Mount: under AccessStatusNotice (AppContent.tsx).
 */
import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { evaluateEntitlement } from '../../../core/entitlement/useEntitlement';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';
import { useHeldWorkCount } from '../../sync/hooks/useHeldWorkCount';
import { toMarathiDigits } from '../../labour/marathiDate';
import { SANS } from '../../../shared/components/ui/placeUi';

/** PROPOSED (Marathi) — both lines. */
export const HELD_WORK_COPY = {
    // PROPOSED (Marathi)
    held: (count: number) =>
        `शेताची मुदत संपली आहे — तुमच्या ${toMarathiDigits(count)} नोंदी फोनवर सुरक्षित आहेत. मुदत वाढताच त्या आपोआप पाठवल्या जातील.`,
    // PROPOSED (Marathi)
    blocked: 'शेताची मुदत संपली आहे — नवीन नोंदी फोनवर सुरक्षित राहतील. मुदत वाढताच त्या आपोआप पाठवल्या जातील.',
} as const;

/** The one line, or null when there is nothing to say (exported for the tests). */
export function heldWorkLine(
    heldCount: number,
    farm: Pick<MyFarmDto, 'role' | 'subscription'> | null | undefined,
): string | null {
    if (heldCount > 0) {
        return HELD_WORK_COPY.held(heldCount);
    }

    if (!farm?.subscription) {
        return null;
    }

    const decision = evaluateEntitlement(farm.subscription, farm.role, 'write');
    return decision.allowed ? null : HELD_WORK_COPY.blocked;
}

interface HeldWorkNoticeProps {
    /** The open farm as `/shramsafal/farms/mine` listed it (id + role + subscription snapshot). */
    farm: Pick<MyFarmDto, 'farmId' | 'role' | 'subscription'> | null | undefined;
}

const HeldWorkNotice: React.FC<HeldWorkNoticeProps> = ({ farm }) => {
    const heldCount = useHeldWorkCount(farm?.farmId);
    const line = heldWorkLine(heldCount, farm);
    if (!line) return null;

    return (
        <div className="px-4 pt-2" data-testid="held-work-notice" style={{ fontFamily: SANS }}>
            <p role="status" className="m-0 flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] font-bold leading-snug text-amber-900">
                <ShieldCheck size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{line}</span>
            </p>
        </div>
    );
};

export default HeldWorkNotice;
