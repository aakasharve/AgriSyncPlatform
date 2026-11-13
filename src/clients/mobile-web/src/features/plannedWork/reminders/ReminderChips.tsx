/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane REM-1; founder D-79 "categorize and visualize properly") - the chips above a
 * reminder list: सगळ्या · नियोजनातून · शेड्यूलमधून · नोंदीतून, each with how many it holds. One tap filters the list; the same tap on the
 * chip already chosen changes nothing. Marathi mode shows only Marathi, English mode only English (`plannedWorkWords`).
 */
import React from 'react';
import { Tap } from '../../../shared/components/ui/placeUi';
import { digitsFor } from '../../../shared/utils/marathiDigits';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { plannedWorkWords } from '../plannedWorkWords';
import { REMINDER_CHIPS, chipLabel, type ReminderChip } from './reminderModel';

export const ReminderChips: React.FC<{
    value: ReminderChip;
    onChange: (chip: ReminderChip) => void;
    counts: Record<ReminderChip, number>;
    testId?: string;
}> = ({ value, onChange, counts, testId = 'reminder-chips' }) => {
    const language = useOptionalLanguage()?.language;
    const words = plannedWorkWords(language).reminders;
    return (
        <div role="group" aria-label={words.chipsLabel} data-testid={testId} className="flex flex-wrap gap-2">
            {REMINDER_CHIPS.map(chip => {
                const on = chip === value;
                return (
                    <Tap key={chip} onClick={() => onChange(chip)} aria-pressed={on} data-testid={`${testId}-${chip}`}
                        className={`min-h-[40px] rounded-full px-3.5 text-[14px] font-extrabold ring-1 ${on ? 'bg-emerald-700 text-white ring-emerald-700' : 'bg-white text-stone-800 ring-stone-300'}`}>
                        {chipLabel(words, chip)} <span className="opacity-80">({digitsFor(counts[chip], language)})</span>
                    </Tap>
                );
            })}
        </div>
    );
};

export default ReminderChips;
