/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (design-fidelity pass; founder 2026-11-26 "exact replication") — the two head pieces the saved
 * screen and the detail page share, drawn as the approved design draws them (sathi-ring.src.html `.hstrip .chip` / `.adtop .chip`
 * and `.spk`): the white pill chip, and "आज कोणी सांगितलं:" with one pill per person and how many times (the screen's own
 * `day.speakers`, counted by the model; nothing is worked out here). The holder is green, everyone else blue.
 */
import React from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import type { DayView } from '../voiceResult/resultModel';
import { resultDayStr, useResultStr } from '../voiceResult/resultStrings';

/** The design's `.hstrip .chip` (and `.adtop .chip`). */
export const HEAD_CHIP = 'inline-block whitespace-nowrap rounded-full border border-[#DDE3DA] bg-white px-[11px] py-1 text-[13px] font-extrabold text-[#1C1917]';

export interface SavedSpeakersProps {
    day: DayView;
    /** A recording saved for a past day: its short name; null = today. */
    onDay: string | null;
    testId: string;
}

export const SavedSpeakers: React.FC<SavedSpeakersProps> = ({ day, onDay, testId }) => {
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    const DS = resultDayStr(language);
    return (
        <div className="flex flex-wrap items-center gap-[5px] rounded-[14px] border border-[#DDE3DA] bg-white px-2.5 py-1.5" data-testid={testId}>
            <span className="text-[12px] font-extrabold text-[#5F6B63]">{onDay ? DS.who(onDay) : RS.todayWho}:</span>
            {day.speakers.map(s => (
                <span key={`${s.you}-${s.name}`} data-you={s.you ? 'yes' : 'no'}
                    className={`rounded-full border px-[9px] py-px text-[12px] font-extrabold ${s.you ? 'border-[#86EFAC] bg-[#F0FDF4] text-[#14532D]' : 'border-[#93C5FD] bg-[#EFF6FF] text-[#1E3A8A]'}`}>
                    {s.name} · {digitsFor(RS.times(s.times), language)}
                </span>
            ))}
        </div>
    );
};

export default SavedSpeakers;
