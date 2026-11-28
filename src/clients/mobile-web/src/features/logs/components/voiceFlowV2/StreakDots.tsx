/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1) — the 7 days inside the meter card, as the final design draws them
 * (result-v12-final.html `.streak`): "गेले ७ दिवस / भरलेले = बोललेले दिवस", then one dot per day, oldest first, today ringed, each
 * under its weekday's letter. A filled dot is a day the phone holds a talk of (`streakWeek`); the row is drawn only when the days
 * can be trusted (the caller passes null otherwise and nothing is drawn).
 */
import React from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { finalResultWords } from './finalResultWords';
import { SANS, Tick } from './savedBits';
import type { StreakDay } from './streakWeek';

export const StreakDots: React.FC<{ days: readonly StreakDay[] | null }> = ({ days }) => {
    const FW = finalResultWords(useOptionalLanguage()?.language);
    if (!days || days.length !== 7) return null;
    return (
        <div className="mt-1 flex items-center justify-between gap-2 self-stretch border-t border-dashed border-[#E6D7AE] pt-2" data-testid="vr2-streak" style={{ fontFamily: SANS }}>
            <div className="text-[12px] font-extrabold leading-[1.25] text-[#6B5D33]">
                {FW.streakTitle}
                <small className="block text-[11px] font-bold text-[#8A7A4F]">{FW.streakSub}</small>
            </div>
            <div className="flex gap-[5px]">
                {days.map(d => (
                    <span key={d.dateKey} className="flex flex-col items-center gap-0.5" data-testid="vr2-streak-day" data-date={d.dateKey}
                        data-told={d.told ? 'yes' : 'no'} data-today={d.today ? 'yes' : 'no'}>
                        <i className={`grid h-5 w-5 place-items-center rounded-full border-2 ${d.told ? 'border-[#1E9E5A] bg-[#1E9E5A]' : 'border-[#E2D5AE] bg-[#FFFDF6]'}`}
                            style={d.today ? { boxShadow: '0 0 0 2px #FFF6D8, 0 0 0 4px #0F6B3A' } : undefined} aria-hidden="true">
                            {d.told && <Tick size={11} />}
                        </i>
                        <span className="text-[10.5px] font-extrabold leading-none text-[#8A7A4F]">{FW.weekdays[d.weekday]}</span>
                    </span>
                ))}
            </div>
        </div>
    );
};

export default StreakDots;
