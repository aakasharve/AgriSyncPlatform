/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2 (MU design §5, §6). The invited person's card:
 * "‹farm› ने तुम्हाला बोलावलं आहे · जबाबदारी: … · प्लॉट … · स्वीकारा / नको" (PROPOSED), with the plain-word authorities
 * ("हजेरी घेऊ शकतात", "पैसे दिसत नाहीत"). Every word is drawn from the grant the SERVER sent. स्वीकारा and नको send the
 * answer and the card then shows what the server said: Active (in at once), waiting for the owner, declined, or why it
 * cannot be used — never "done" before the server answered.
 */
import React, { useState } from 'react';
import { CheckCircle2, Clock3, MailOpen, XCircle } from 'lucide-react';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { invitationCopy } from './invitationCopy';
import { cardLines, dayOf } from './invitationModel';
import {
    acceptInvitation,
    declineInvitation,
    invitationRefusal,
    type InvitationAccepted,
    type InvitationCard as InvitationCardData,
    type InvitationRefusal,
} from './personalInvitationClient';

type Phase = 'open' | 'sending' | 'active' | 'waiting' | 'declined' | 'refused';

export interface InvitationCardProps {
    card: InvitationCardData;
    /** The code he typed or scanned (the card came from it); absent = the card listed for his proven number. */
    code?: string;
    /** The server let him in, or made the request: the caller refreshes his farms. */
    onAnswered?: (answer: InvitationAccepted | null) => void;
}

export const InvitationCard: React.FC<InvitationCardProps> = ({ card, code, onAnswered }) => {
    const language = useOptionalLanguage()?.language;
    const copy = invitationCopy(language);
    const lines = cardLines(card, copy, language);
    const initialRefusal = refusalOfStatus(card.status);
    const [phase, setPhase] = useState<Phase>(initialRefusal ? 'refused' : 'open');
    const [refusal, setRefusal] = useState<InvitationRefusal | null>(initialRefusal);
    const answerKey = code ? { code } : { invitationId: card.invitationId };

    const accept = async () => {
        setPhase('sending');
        try {
            const answer = await acceptInvitation(answerKey);
            setPhase(answer.status === 'Active' ? 'active' : 'waiting');
            onAnswered?.(answer);
        } catch (error) {
            setRefusal(invitationRefusal(error));
            setPhase('refused');
        }
    };

    const decline = async () => {
        setPhase('sending');
        try {
            await declineInvitation(answerKey);
            setPhase('declined');
            onAnswered?.(null);
        } catch (error) {
            setRefusal(invitationRefusal(error));
            setPhase('refused');
        }
    };

    return (
        <section data-testid={`invitation-card-${card.invitationId}`} className="space-y-3 rounded-3xl bg-white p-4 ring-1 ring-emerald-200">
            <header className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
                    <MailOpen size={22} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                    <h3 className="m-0 text-[18px] font-extrabold leading-snug text-stone-900 [overflow-wrap:anywhere]" data-testid="invitation-title">
                        {copy.invitedYou(card.farmName)}
                    </h3>
                    {card.invitedByName && (
                        <p className="m-0 text-[13px] font-bold text-stone-500">{copy.invitedBy(card.invitedByName)}</p>
                    )}
                </div>
            </header>

            <ul className="m-0 space-y-1 p-0" data-testid="invitation-lines">
                <li className="list-none text-[15px] font-extrabold text-stone-800" data-testid="invitation-responsibility">{lines.responsibility}</li>
                <li className="list-none text-[15px] font-bold text-stone-700" data-testid="invitation-plots">{lines.plots}</li>
                {lines.authorities.map(line => (
                    <li key={line} className="list-none text-[14px] font-semibold text-stone-700" data-testid="invitation-authority">{line}</li>
                ))}
            </ul>

            <p className="m-0 text-[12.5px] font-bold text-stone-500" data-testid="invitation-valid">{copy.validUntil(dayOf(card.expiresAtUtc, language))}</p>
            {card.namesAWorker && card.namesYou !== false && (
                <p className="m-0 text-[13px] font-bold text-emerald-800">{copy.linksWorker}</p>
            )}
            {card.namesYou === false && phase === 'open' && (
                <p className="m-0 text-[13px] font-bold text-amber-800" data-testid="invitation-waits-note">{copy.namesSomeoneElse}</p>
            )}

            {(phase === 'open' || phase === 'sending') && (
                <div className="flex gap-2">
                    <button type="button" data-testid="invitation-accept" disabled={phase === 'sending'} onClick={() => void accept()}
                        className="min-h-[52px] flex-1 rounded-2xl bg-emerald-600 text-[17px] font-extrabold text-white disabled:opacity-60">
                        {copy.accept}
                    </button>
                    <button type="button" data-testid="invitation-decline" disabled={phase === 'sending'} onClick={() => void decline()}
                        className="min-h-[52px] flex-1 rounded-2xl bg-white text-[17px] font-extrabold text-stone-700 ring-1 ring-stone-300 disabled:opacity-60">
                        {copy.decline}
                    </button>
                </div>
            )}

            {phase === 'active' && (
                <p role="status" data-testid="invitation-active" className="m-0 flex items-center gap-2 text-[16px] font-extrabold text-emerald-800">
                    <CheckCircle2 size={20} aria-hidden="true" />{copy.acceptedTitle(card.farmName)}
                </p>
            )}
            {phase === 'waiting' && (
                <div role="status" data-testid="invitation-waiting" className="space-y-1">
                    <p className="m-0 flex items-center gap-2 text-[16px] font-extrabold text-amber-800">
                        <Clock3 size={20} aria-hidden="true" />{copy.waitingTitle}
                    </p>
                    <p className="m-0 text-[14px] font-bold text-stone-700">{copy.waitingLine}</p>
                </div>
            )}
            {phase === 'declined' && (
                <p role="status" data-testid="invitation-declined" className="m-0 text-[15px] font-extrabold text-stone-700">{copy.declinedTitle}</p>
            )}
            {phase === 'refused' && refusal && (
                <p role="alert" data-testid="invitation-refused" className="m-0 flex items-start gap-2 text-[15px] font-extrabold leading-snug text-rose-700">
                    <XCircle size={20} className="shrink-0" aria-hidden="true" />{copy.refusal[refusal]}
                </p>
            )}
        </section>
    );
};

/** An ended invitation found by its code says why at once (expired, used, declined, withdrawn). */
function refusalOfStatus(status: string | undefined): InvitationRefusal | null {
    switch (status) {
        case 'Expired': return 'expired';
        case 'Accepted': return 'used';
        case 'Declined': return 'declined';
        case 'Withdrawn': return 'withdrawn';
        default: return null;
    }
}

export default InvitationCard;
