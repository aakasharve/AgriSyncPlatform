/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JoinRequestCard — "X आत येऊ इच्छितात": a person who typed the farm code (or scanned the farm QR
 * after the owner had stopped him) is waiting. The PRIMARY owner chooses what he may do — the
 * joiner never chooses (PLR-D7 founder rule) — in one tap:
 *   काम सांगणे (Worker) · काम + हजेरी (Mukadam + the existing हजेरी व पक्कं grant),
 * or says नको. Founder D-22 (26 Oct): a family / co-owner choice is not offered here in step 2 —
 * its powers come as visible switches in the proposed step 2b.
 *
 * Under the self-typed name: how he asked, and the last four digits of his account phone (M-7) so
 * the owner can tell who is really asking.
 *
 * Design ported from the approved preview's approve frame (plr-d1a `multiuser/MuFlow.tsx` frame 4).
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, AC2, MU-7).
 */
import React, { useState } from 'react';
import { Smartphone, UserPlus } from 'lucide-react';
import { Tap } from '../../../shared/components/ui/placeUi';
import type { LabourPermission } from '../data/labourPermissionsClient';
import type { ApprovePreset } from '../data/membershipAdminClient';
import { PRESETS, phoneLine } from './teamModel';
import { ReasonStep } from './ReasonStep';
import { TEAM_COPY } from './teamCopy';

export interface JoinRequestCardProps {
    row: LabourPermission;
    name: string;
    busy: boolean;
    onApprove: (preset: ApprovePreset) => void;
    onDecline: (reason: string) => void;
}

export const JoinRequestCard: React.FC<JoinRequestCardProps> = ({ row, name, busy, onApprove, onDecline }) => {
    const [declining, setDeclining] = useState(false);
    const via = row.joinedVia === 'SelfJoin' ? TEAM_COPY.viaCode : row.joinedVia === 'QrScan' ? TEAM_COPY.viaQr : null;
    const phone = phoneLine(row);

    return (
        <li className="list-none space-y-2 rounded-3xl border-2 border-[#1448E6] bg-white p-3.5" data-testid={`join-request-${row.userId}`}>
            <p className="m-0 flex items-start gap-2 text-[17px] font-extrabold leading-snug text-stone-900">
                <UserPlus size={20} className="mt-0.5 shrink-0 text-[#1448E6]" aria-hidden="true" />
                {TEAM_COPY.wantsIn(name)}
            </p>
            {phone && (
                <p className="m-0 flex items-center gap-1.5 text-[14px] font-extrabold text-stone-800" data-testid={`join-request-phone-${row.userId}`}>
                    <Smartphone size={16} aria-hidden="true" />{phone}
                </p>
            )}
            {via && <p className="m-0 text-[13px] font-bold text-stone-600">{via}</p>}
            <p className="m-0 text-[14px] font-extrabold text-stone-800">{TEAM_COPY.quick}</p>
            <div className="grid grid-cols-1 gap-2">
                {PRESETS.map(p => (
                    <Tap key={p.id} disabled={busy} data-testid={`approve-${p.id}-${row.userId}`}
                        onClick={() => onApprove(p.id)}
                        className="min-h-[56px] rounded-2xl border-2 border-emerald-600 bg-emerald-50 px-3 py-2 text-left disabled:opacity-60">
                        <span className="block text-[16px] font-extrabold text-stone-900">{p.label}</span>
                        <span className="block text-[12.5px] font-semibold leading-snug text-stone-600">{p.hint}</span>
                    </Tap>
                ))}
            </div>
            {declining ? (
                <ReasonStep question={TEAM_COPY.declineAsk} confirmLabel={TEAM_COPY.decline} busy={busy}
                    onConfirm={reason => onDecline(reason)} onCancel={() => setDeclining(false)}
                    testId={`decline-step-${row.userId}`} />
            ) : (
                <Tap disabled={busy} onClick={() => setDeclining(true)} data-testid={`decline-${row.userId}`}
                    className="min-h-[48px] rounded-full border-2 border-stone-300 bg-white px-5 text-[15px] font-extrabold text-stone-700 disabled:opacity-60">
                    {TEAM_COPY.decline}
                </Tap>
            )}
        </li>
    );
};

export default JoinRequestCard;
