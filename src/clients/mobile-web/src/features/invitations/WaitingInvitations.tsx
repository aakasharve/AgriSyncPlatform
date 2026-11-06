/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2 (MU design §6, §11.3a). After OTP sign-in: every waiting
 * invitation that named his PROVEN number, each as its card (स्वीकारा / नको). Read from the ONE read model, `/me/context`
 * (`invitations`) — never a parallel list. A waiting invitation is never a farm: it is not in the switcher and carries
 * nothing of the farm's data; it becomes one only when the server says Active.
 */
import React, { useEffect, useState } from 'react';
import { fetchMeContext, invalidateMeContext } from '../../core/session/MeContextService';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { InvitationCard } from './InvitationCard';
import { invitationCopy } from './invitationCopy';
import type { InvitationCard as InvitationCardData, InvitationLabel } from './personalInvitationClient';

export const WaitingInvitations: React.FC<{ onAnswered?: () => void }> = ({ onAnswered }) => {
    const copy = invitationCopy(useOptionalLanguage()?.language);
    const [cards, setCards] = useState<InvitationCardData[]>([]);

    useEffect(() => {
        let live = true;
        fetchMeContext({ force: true })
            .then(ctx => {
                if (!live) return;
                const listed = Array.isArray(ctx.invitations) ? ctx.invitations : [];
                // Listed because it named his proven number: स्वीकारा lets him in at once.
                setCards(listed.map(i => ({ ...i, label: i.label as InvitationLabel, status: 'Waiting', namesYou: true })));
            })
            .catch(() => { if (live) setCards([]); });
        return () => { live = false; };
    }, []);

    if (cards.length === 0) return null;

    return (
        <section className="space-y-2" data-testid="waiting-invitations">
            <h2 className="m-0 px-1 text-[16px] font-extrabold text-stone-800">{copy.waitingInvitationsTitle}</h2>
            {cards.map(card => (
                <InvitationCard key={card.invitationId} card={card}
                    onAnswered={() => { invalidateMeContext(); onAnswered?.(); }} />
            ))}
        </section>
    );
};

export default WaitingInvitations;
