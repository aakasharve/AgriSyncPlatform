/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-57 / D-58) — the हजेरी door heard him, but
 * nothing in his words was हजेरी (who came, how many). It used to open the old hand-filled form, empty. Now it says so,
 * keeps his words on screen (nothing he said is dropped), and offers the one way that can fix it: "पुन्हा सांगा" — the
 * same हजेरी mic, for the हजेरी part only. Nothing is saved from here.
 */
import React from 'react';
import { HelpCircle, Mic } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';

const SANS = "'Noto Sans Devanagari', sans-serif";

const WORDS = {
    mr: {
        title: 'यात हजेरी समजली नाही.', // PROPOSED (Marathi)
        body: 'कोण आलं, किती जण होते ते पुन्हा सांगा — उदा. “आज रमेश, सुनीता आणि आणखी तीन जण होते”.', // PROPOSED (Marathi)
        youSaid: 'तुम्ही सांगितलं', // PROPOSED (Marathi)
        again: 'पुन्हा सांगा', // PROPOSED (Marathi)
    },
    en: {
        title: 'No attendance was understood in this.', // PROPOSED (English)
        body: 'Say again who came and how many — e.g. "Ramesh, Sunita and three more came today".', // PROPOSED (English)
        youSaid: 'You said', // PROPOSED (English)
        again: 'Say it again', // PROPOSED (English)
    },
} as const;

export const AttendanceNotHeard: React.FC<{ transcript: string; onSpeakAgain: () => void }> = ({ transcript, onSpeakAgain }) => {
    const language = useOptionalLanguage()?.language;
    const w = language === 'en' ? WORDS.en : WORDS.mr;
    return (
        <div className="flex flex-col gap-3 pb-6" style={{ fontFamily: SANS }} data-testid="attendance-not-heard">
            {transcript.trim() && (
                <div className="rounded-2xl border border-stone-200 bg-white p-3 text-[16px] font-bold text-stone-900" data-testid="attendance-not-heard-said">
                    <span className="text-[13px] text-stone-600">{w.youSaid}: </span>“{transcript.trim()}”
                </div>
            )}
            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-[15px] font-bold leading-snug text-amber-950">
                <p className="m-0 flex items-center gap-1.5 font-extrabold"><HelpCircle size={18} aria-hidden="true" />{w.title}</p>
                <p className="m-0 mt-0.5">{w.body}</p>
            </div>
            <div className="text-center">
                <button type="button" onClick={onSpeakAgain} aria-label={w.again} data-testid="attendance-not-heard-again"
                    className="mx-auto grid h-[96px] w-[96px] place-items-center rounded-full bg-emerald-700 text-white shadow-[0_8px_24px_rgba(4,120,87,0.35)] active:scale-95">
                    <Mic size={42} aria-hidden="true" />
                </button>
                <p className="m-0 mt-1.5 text-[17px] font-extrabold text-stone-900">{w.again}</p>
            </div>
        </div>
    );
};

export default AttendanceNotHeard;
