/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-1 item 10 (R2-B 15 with the founder's changes, 27 Nov) — the माझी टीम step of the first setup, as a card in the
 * Setup Hub's sequence, while the farm open in the app has only its owner and no invitation stands:
 *   - the question "तुमच्यासोबत शेतीचं काम कोण पाहतं?" and three big choices — कुटुंबातील सदस्य (the कुटुंब label) · कामगार ·
 *     मुकादम — each opening the EXISTING invite sheet with that label chosen;
 *   - a small "सध्या मी एकटाच शेती पाहतो" that clears the step for THIS farm (the caller keeps that mark per farm);
 *   - the step's red "बाकी" (the app's danger colour, the same as the plots' pending mark). It never blocks anything.
 * No "विश्वास" word on it (founder). Marathi mode Marathi only; English mode English only.
 */
import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { Tap } from '../../../shared/components/ui/placeUi';
import { listInvitations, type InvitationLabel, type PersonalInvitationView } from '../../invitations/personalInvitationClient';

/** The three choices, in the founder's order (कुटुंबातील सदस्य = the कुटुंब label). */
export const TEAM_FIRST_CHOICES: readonly Extract<InvitationLabel, 'Family' | 'Worker' | 'Mukadam'>[] = ['Family', 'Worker', 'Mukadam'];

export const TEAM_FIRST_WORDS = {
    mr: {
        title: 'माझी टीम',
        question: 'तुमच्यासोबत शेतीचं काम कोण पाहतं?',
        choice: { Family: 'कुटुंबातील सदस्य', Worker: 'कामगार', Mukadam: 'मुकादम' },
        solo: 'सध्या मी एकटाच शेती पाहतो',
        pending: 'बाकी',
    },
    en: {
        title: 'My team',
        question: 'Who looks after the farm work with you?',
        choice: { Family: 'Family member', Worker: 'Worker', Mukadam: 'Mukadam' },
        solo: 'For now I run the farm alone',
        pending: 'Pending',
    },
} as const;

/** The step's red "बाकी" chip — the danger colour (rose), the same as the plots' pending mark. */
export const TeamPendingChip: React.FC<{ label: string }> = ({ label }) => (
    <span data-testid="hub-team-status" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[12.5px] font-extrabold text-rose-800">{label}</span>
);

export const TeamFirstStepCard: React.FC<{
    language?: 'mr' | 'en';
    isNext: boolean;
    onPick: (label: InvitationLabel) => void;
    onSolo: () => void;
}> = ({ language, isNext, onPick, onSolo }) => {
    const w = language === 'en' ? TEAM_FIRST_WORDS.en : TEAM_FIRST_WORDS.mr;
    return (
        <section data-testid="hub-team-first"
            className={`rounded-2xl border bg-white p-3 shadow-[0_1px_2px_rgba(28,25,23,0.05)] ${isNext ? 'border-emerald-300 ring-2 ring-emerald-200' : 'border-rose-200'}`}>
            <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-100 text-blue-800"><Users size={20} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1 text-[16px] font-extrabold leading-tight text-stone-900">{w.title}</span>
                <TeamPendingChip label={w.pending} />
            </div>
            <p className="m-0 mt-2.5 text-[17px] font-extrabold leading-snug text-stone-900">{w.question}</p>
            <div className="mt-2.5 grid gap-2">
                {TEAM_FIRST_CHOICES.map(label => (
                    <Tap key={label} onClick={() => onPick(label)} data-testid={`hub-team-first-${label}`}
                        className="min-h-[52px] w-full rounded-2xl bg-emerald-50 px-4 text-left text-[16px] font-extrabold text-emerald-900 ring-1 ring-emerald-300">
                        {w.choice[label]}
                    </Tap>
                ))}
            </div>
            <Tap onClick={onSolo} data-testid="hub-team-solo"
                className="mt-2 min-h-[44px] w-full rounded-full text-[14px] font-bold text-stone-600 underline underline-offset-4">
                {w.solo}
            </Tap>
        </section>
    );
};

/**
 * The invitations the primary owner sent on this farm, read for the step (null = not known yet, or not read: never a guess).
 * `refreshKey` re-reads after the invite sheet made one.
 */
export function useSentInvitations(farmId: string | null, refreshKey = 0): PersonalInvitationView[] | null {
    const [rows, setRows] = useState<PersonalInvitationView[] | null>(null);
    useEffect(() => {
        setRows(null);
        if (!farmId) return;
        let live = true;
        listInvitations(farmId)
            .then(list => { if (live) setRows(list); })
            .catch((error: unknown) => {
                // Landing place: the console trace; the step then stays uncounted (never a false red, never a false पूर्ण).
                console.warn('[setup-hub] the sent invitations could not be read for the team step', error);
                if (live) setRows(null);
            });
        return () => { live = false; };
    }, [farmId, refreshKey]);
    return rows;
}
