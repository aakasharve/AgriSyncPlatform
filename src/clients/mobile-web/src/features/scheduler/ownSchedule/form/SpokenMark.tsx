/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 16, phone half; doctrine P8) - the small line under a timer box he did not type:
 * "बोलण्यातून" and the words it was heard from, so he sees what was heard.
 */
import React from 'react';
import type { OwnLanguage } from '../ownScheduleWords';
import { SPOKEN_TIMER_WORDS } from './spokenTimerWords';

export const SpokenMark: React.FC<{ testId: string; heard: string; language: OwnLanguage }> = ({ testId, heard, language }) => {
    const w = SPOKEN_TIMER_WORDS[language];
    return (
        <p className="m-0 mt-1 rounded-xl bg-emerald-50 px-3 py-1.5 text-[13px] font-bold leading-snug text-emerald-900" data-testid={testId}>
            <b className="font-extrabold">{w.fromWords}</b> · {w.heardLine(heard)}
        </p>
    );
};
