/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane REM-1; founder D-78, D-84 = 1; R14-R16) - the lines a reminder's card carries under
 * its words: who made it and when ("‹नाव› · ‹तारीख›, ‹वेळ›"), where it came from ("बोलण्यातून — G1ची नोंद", "अर्धवट राहिलेलं"), "ऐका" for the
 * source voice (only when the server says he may hear it; the voice is played by the original-voice door and never copied), the
 * ShramSafal rule when a recording exists that he may not hear, the money rule card in place of words he may not read, and the two D-84 = 1
 * lines (the marked maker's, and the one for a record kept for chosen people). Every line is something the server said; none is made up.
 */
import React from 'react';
import type { PlannedTask } from '../../../types';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import OriginalVoiceButton from '../../logs/components/originalVoice/OriginalVoiceButton';
import MoneyWordsWithheldCard from '../../logs/components/originalVoice/MoneyWordsWithheldCard';
import { plannedWorkWords } from '../plannedWorkWords';
import { reminderLines } from './reminderModel';

export const ReminderCardLines: React.FC<{ task: PlannedTask; placeLabel?: string; testIdPrefix?: string }> = ({ task, placeLabel, testIdPrefix = 'reminder' }) => {
    const language = useOptionalLanguage()?.language;
    // The task's own farm (the server's row says it): the original-voice door is asked for THAT farm's log.
    const farmId = task.listSource?.farmId ?? null;
    const lines = reminderLines(task, language, placeLabel);
    if (!lines) return null;
    const words = plannedWorkWords(language).reminders;
    const id = task.id;
    return (
        <div className="mt-1 space-y-1" data-testid={`${testIdPrefix}-lines-${id}`}>
            {lines.byline && <p className="m-0 text-[12.5px] font-bold text-stone-600" data-testid={`${testIdPrefix}-byline-${id}`}>{lines.byline}</p>}
            {lines.sourceLine && (
                <p className={`m-0 text-[12.5px] font-extrabold ${lines.leftover ? 'text-amber-800' : 'text-stone-600'}`} data-testid={`${testIdPrefix}-source-${id}`}>{lines.sourceLine}</p>
            )}
            {lines.wordsWithheld && <MoneyWordsWithheldCard testId={`${testIdPrefix}-money-withheld-${id}`} />}
            {lines.voice === 'play' && lines.voiceLogId && farmId && (
                <div data-testid={`${testIdPrefix}-listen-${id}`}>
                    <OriginalVoiceButton dailyLogId={lines.voiceLogId} farmId={farmId} playLabel={words.listen} />
                </div>
            )}
            {lines.voice === 'rule' && (
                <p className="m-0 text-[12.5px] font-bold text-stone-600" data-testid={`${testIdPrefix}-voice-rule-${id}`}>{words.voiceRule}</p>
            )}
            {lines.markedMaker && <p className="m-0 text-[12.5px] font-bold text-emerald-800" data-testid={`${testIdPrefix}-marked-${id}`}>{words.markedMaker}</p>}
            {lines.chosenPeople && <p className="m-0 text-[12.5px] font-bold text-stone-600" data-testid={`${testIdPrefix}-chosen-${id}`}>{words.chosenPeople}</p>}
        </div>
    );
};

export default ReminderCardLines;
