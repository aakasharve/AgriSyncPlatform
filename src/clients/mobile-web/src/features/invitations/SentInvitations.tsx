/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2. The PRIMARY owner's invitations on the team page: each
 * with what it grants and where it stands. A waiting one can be shown again (the SAME code and link) or taken back; a
 * claim that waits for him is let in with ONE tap ("आत घ्या"), which applies exactly that invitation's grant. Server
 * truth only: every row is what the server last said; a decision adopts the server's answer.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { invitationCopy } from './invitationCopy';
import { cardLines, displayInvitationCode } from './invitationModel';
import {
    approveInvitationClaim,
    invitationRefusal,
    listInvitations,
    withdrawInvitation,
    type InvitationRefusal,
    type PersonalInvitationView,
} from './personalInvitationClient';

export interface SentInvitationsProps {
    farmId: string;
    /** Changes whenever the builder made a new one (the list reloads). */
    refreshKey?: number;
    onShowAgain: (invitation: PersonalInvitationView) => void;
    /** A claimant was let in: the caller reloads the roster. */
    onLetIn?: () => void;
}

export const SentInvitations: React.FC<SentInvitationsProps> = ({ farmId, refreshKey = 0, onShowAgain, onLetIn }) => {
    const language = useOptionalLanguage()?.language;
    const copy = invitationCopy(language);
    const [rows, setRows] = useState<PersonalInvitationView[] | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [refusal, setRefusal] = useState<InvitationRefusal | null>(null);

    const load = useCallback(async () => {
        try {
            setRows(await listInvitations(farmId));
        } catch {
            // The list could not be read: nothing is drawn (never an empty "no invitations" that may be untrue). The
            // owner's decisions below still say their own refusals.
            setRows(null);
        }
    }, [farmId]);

    useEffect(() => { void load(); }, [load, refreshKey]);

    const act = async (id: string, run: () => Promise<unknown>, after?: () => void) => {
        setBusyId(id);
        setRefusal(null);
        try {
            await run();
            after?.();
            await load();
        } catch (error) {
            setRefusal(invitationRefusal(error));
        } finally {
            setBusyId(null);
        }
    };

    if (!rows || rows.length === 0) return null;

    return (
        <section className="space-y-2" data-testid="sent-invitations">
            <h3 className="m-0 px-1 text-[15px] font-extrabold text-stone-800">{copy.sentTitle}</h3>
            {refusal && <p role="alert" className="m-0 text-[13px] font-bold text-rose-700">{copy.refusal[refusal]}</p>}
            <ul className="m-0 space-y-2 p-0">
                {rows.map(row => {
                    const lines = cardLines(row, copy, language);
                    const statusWord = row.waitsForOwner ? copy.waitsForYou : copy.status[row.status] ?? row.status;
                    return (
                        <li key={row.id} data-testid={`sent-invitation-${row.id}`} className="list-none space-y-1 rounded-2xl bg-white p-3 ring-1 ring-stone-200">
                            <div className="flex items-center justify-between gap-2">
                                <span className="min-w-0 text-[15px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">
                                    {row.name ?? copy.labels[row.label]}{row.invitedPhoneLast4 ? ` · …${row.invitedPhoneLast4}` : ''}
                                </span>
                                <span className="shrink-0 text-[12.5px] font-extrabold text-stone-600" data-testid="sent-status">{statusWord}</span>
                            </div>
                            <p className="m-0 text-[13px] font-bold text-stone-700">{lines.responsibility} · {lines.plots}</p>
                            <p className="m-0 text-[12.5px] font-semibold text-stone-600">{lines.authorities.join(' · ')}</p>
                            {row.status === 'Waiting' && (
                                <div className="flex gap-2 pt-1">
                                    <button type="button" data-testid={`sent-show-${row.id}`} onClick={() => onShowAgain(row)}
                                        className="min-h-[44px] flex-1 rounded-xl bg-emerald-50 text-[14px] font-extrabold text-emerald-800 ring-1 ring-emerald-200">
                                        {copy.showAgain} · {displayInvitationCode(row.code)}
                                    </button>
                                    <button type="button" data-testid={`sent-withdraw-${row.id}`} disabled={busyId === row.id}
                                        onClick={() => void act(row.id, () => withdrawInvitation(farmId, row.id))}
                                        className="min-h-[44px] flex-1 rounded-xl bg-white text-[14px] font-extrabold text-stone-700 ring-1 ring-stone-300 disabled:opacity-60">
                                        {copy.withdraw}
                                    </button>
                                </div>
                            )}
                            {row.status === 'Accepted' && row.waitsForOwner && (
                                <button type="button" data-testid={`sent-let-in-${row.id}`} disabled={busyId === row.id}
                                    onClick={() => void act(row.id, () => approveInvitationClaim(farmId, row.id), onLetIn)}
                                    className="min-h-[48px] w-full rounded-xl bg-emerald-600 text-[15px] font-extrabold text-white disabled:opacity-60">
                                    {copy.letIn}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};

export default SentInvitations;
