/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 7; founder D-H 2026-11-21) - the answer card for "why
 * wasn't this done?". Voice first, never voice only (TAP-1): the microphone on top, then the founder's eight reasons as buttons, an
 * optional "अडचण" box, and "नंतर". "केलं, पण नोंद केली नाही" opens that day's "त्या दिवसाचं काम सांगा" (the existing past-day
 * flow) instead of changing anything. Presentational: the host owns the writes; his answer never changes the record.
 */
import React, { useState } from 'react';
import { Mic } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { resultCopy } from './voiceResult/resultCopy';
import {
    WHY_NOT_REASONS, WHY_NOT_CHALLENGE_LABEL_MR, WHY_NOT_CHALLENGE_MAX, type MissedCard, type WhyNotReason,
} from '../services/dfesWhyNot';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface WhyNotAnswerProps {
    card: MissedCard;
    /** The resolved question (Marathi). */
    prompt: string;
    /** A reason tapped, with what he typed in "अडचण" (trimmed; null when empty). */
    onReason: (code: WhyNotReason, challenge: string | null) => void;
    /** "केलं, पण नोंद केली नाही": the host records it and opens that day's past-day flow. */
    onDidItNotLogged: (dateKey: string, challenge: string | null) => void;
    /** Opens the microphone with the question pinned; absent = no route, no mic button. */
    onSpeak?: () => void;
    /** "नंतर": the engine's own skip. */
    onLater: () => void;
}

export const WhyNotAnswer: React.FC<WhyNotAnswerProps> = ({ card, prompt, onReason, onDidItNotLogged, onSpeak, onLater }) => {
    const copy = resultCopy(useOptionalLanguage()?.language);
    const [challenge, setChallenge] = useState('');
    const typed = (): string | null => challenge.trim() || null;
    return (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5" style={{ fontFamily: SANS }} data-testid="why-not-answer" lang="mr">
            <h4 className="mb-3 text-[17px] font-extrabold leading-snug text-amber-950" data-testid="why-not-prompt">{prompt}</h4>
            {onSpeak && (
                <button type="button" onClick={onSpeak} data-testid="why-not-speak"
                    className="mb-3 flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 text-lg font-extrabold text-white active:scale-[0.98]">
                    <Mic size={22} aria-hidden="true" /> {copy.speakAnswer}
                </button>
            )}
            <div className="flex flex-wrap gap-2">
                {WHY_NOT_REASONS.map(reason => (
                    <button key={reason.code} type="button" data-testid="why-not-reason" data-code={reason.code}
                        onClick={() => (reason.code === 'done_not_logged' ? onDidItNotLogged(card.dateKey, typed()) : onReason(reason.code, typed()))}
                        className="min-h-[48px] rounded-2xl border border-stone-300 bg-white px-4 text-left text-[15px] font-extrabold text-stone-700 active:scale-95">
                        {reason.labelMr}
                    </button>
                ))}
            </div>
            <label className="mt-3 block text-[14px] font-bold text-amber-900" htmlFor="why-not-challenge">{WHY_NOT_CHALLENGE_LABEL_MR}</label>
            <textarea id="why-not-challenge" data-testid="why-not-challenge" value={challenge} maxLength={WHY_NOT_CHALLENGE_MAX} rows={2}
                onChange={e => setChallenge(e.target.value)}
                className="mt-1 w-full rounded-xl border border-stone-300 bg-white p-2 text-[15px] text-stone-800" />
            <button type="button" onClick={onLater} data-testid="why-not-later"
                className="mt-2 min-h-[48px] rounded-2xl border border-stone-300 bg-white px-4 text-[15px] font-extrabold text-stone-700 active:scale-95">
                {copy.later}
            </button>
        </div>
    );
};

export default WhyNotAnswer;
