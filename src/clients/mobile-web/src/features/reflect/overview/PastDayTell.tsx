/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-60 = 4A) — on a PAST day (reached through the
 * day bar or "कामाचं कॅलेंडर"), the way to fill it: "त्या दिवसाचं काम सांगा · 30 ऑक्टो". It opens the app's normal
 * crop → plot steps with that date in the question, then THE one mic (typing kept); what he says is saved on that day.
 */
import React from 'react';
import { Mic } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { dayShort } from '../../logs/components/dayPick/dayWords';
import { SANS, Tap } from './ui';

const WORDS = {
    mr: { tell: 'त्या दिवसाचं काम सांगा' }, // PROPOSED (Marathi) — the working phones (4A)
    en: { tell: "Tell that day's work" }, // PROPOSED (English)
} as const;

export const PastDayTell: React.FC<{ dateKey: string; onTell: () => void; testId?: string }> = ({ dateKey, onTell, testId = 'past-day-tell' }) => {
    const language = useOptionalLanguage()?.language;
    const w = language === 'en' ? WORDS.en : WORDS.mr;
    return (
        <Tap onClick={onTell} data-testid={testId}
            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-3 text-[17px] font-extrabold text-white shadow-md active:scale-[0.98]"
            style={{ fontFamily: SANS }}>
            <Mic size={20} aria-hidden="true" />{w.tell}
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[14px]" data-testid={`${testId}-day`}>{dayShort(dateKey, language)}</span>
        </Tap>
    );
};

export default PastDayTell;
