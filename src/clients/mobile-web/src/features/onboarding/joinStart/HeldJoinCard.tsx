/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V1-A) — on the number screen, what he gave before
 * signing in: the QR was read, or the code was taken, and what happens once his number is checked. The farm's NAME is not
 * here: the server gives it only to a proven number (see `heldJoin.ts`), so the screen never claims a farm was "found".
 */
import React from 'react';
import { Check } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { displayInvitationCode } from '../../invitations/invitationModel';
import { joinStartCopy } from './joinStartCopy';
import type { HeldJoin } from './heldJoin';

const HeldJoinCard: React.FC<{ held: HeldJoin }> = ({ held }) => {
    const c = joinStartCopy(useOptionalLanguage()?.language);
    const title = held.kind === 'qr' ? c.heldQrTitle : held.kind === 'invitation' ? c.heldInvitationTitle : c.heldCodeTitle;
    const code = held.kind === 'farmCode' ? held.code : held.kind === 'invitation' ? displayInvitationCode(held.code) : null;
    return (
        <div data-testid="held-join-card" data-kind={held.kind} className="mb-4 w-full max-w-sm text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                <Check size={30} strokeWidth={3} aria-hidden="true" />
            </span>
            <p className="m-0 mt-2 font-serif text-[25px] font-bold leading-tight text-emerald-900" data-testid="held-join-title">{title}</p>
            {code && <p className="m-0 mt-1 font-mono text-[20px] font-extrabold tracking-[0.2em] text-stone-900" data-testid="held-join-code">{code}</p>}
            <p className="m-0 mt-1 text-[14.5px] font-bold leading-snug text-stone-700" data-testid="held-join-line">
                {held.kind === 'invitation' ? c.heldInvitationLine : c.heldFarmLine}
            </p>
            {held.kind !== 'invitation' && <p className="m-0 mt-1 text-[13.5px] font-bold text-stone-600">{c.roleNote}</p>}
        </div>
    );
};

export default HeldJoinCard;
