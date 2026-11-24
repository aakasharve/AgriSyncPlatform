/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (design-fidelity pass F3) — the day's earlier recordings in ONE fold, as the approved design draws
 * them (`.early`, `.er`): "आजची आधीची बोलणी (N) · दाबा आणि ऐका"; per recording its time, who and whether it is confirmed, its small
 * player (when its clip is on this phone), his words, and one line of what it told.
 *
 * Everything is read from the record (`RecordingView`): the parts line is each verified entry's part and value as recorded
 * (`entryText`), then the stoppages; a part the server could not find in his words is named under "नक्की समजलं नाही", never as a
 * fact (P4). Typed entries show the typed note in place of a player; words withheld by the money rule show the rule card (MU-3).
 */
import React from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import MoneyWordsWithheldCard from '../originalVoice/MoneyWordsWithheldCard';
import { TypedNote } from '../voiceResult/DayParts';
import { resultCopy } from '../voiceResult/resultCopy';
import type { RecordingView } from '../voiceResult/resultModel';
import { entryText, partNameIn } from '../voiceResult/partNames';
import { resultDayStr, useResultStr } from '../voiceResult/resultStrings';
import { Bd, SANS } from './savedBits';
import SavedClip from './SavedClip';
import { savedWords } from './savedCopy';

/** One line of what a recording told, as recorded. */
const toldLine = (rec: RecordingView, language: string | undefined, unsureWord: string): string => {
    const sure = rec.entries.filter(e => e.verified).map(e => [partNameIn(e.part, language), entryText(e, language, language !== 'en')].filter(Boolean).join(' '));
    const stops = rec.blockers.filter(b => b.verified && b.value).map(b => b.value as string);
    const unsure = [...new Set(rec.entries.filter(e => !e.verified).map(e => partNameIn(e.part, language)))];
    return [...sure, ...stops, ...(unsure.length ? [`${unsureWord}: ${unsure.join(', ')}`] : [])].join(' · ');
};

export interface SavedEarlierProps {
    earlier: readonly RecordingView[];
    /** A recording saved for a past day: its short name; null = today. */
    onDay: string | null;
    clips: ReadonlyMap<string, VoiceClipCacheRecord>;
    playingId: string | null;
    lengthOf: (logId: string) => number | null;
    onTogglePlay: (logId: string) => void;
}

export const SavedEarlier: React.FC<SavedEarlierProps> = ({ earlier, onDay, clips, playingId, lengthOf, onTogglePlay }) => {
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    const SW = savedWords(language);
    const copy = resultCopy(language);
    if (earlier.length === 0) return null;
    const title = onDay ? resultDayStr(language).earlier : SW.earlierToday;
    return (
        <details className="rounded-2xl border border-[#DDE3DA] bg-white px-3 [&_summary::-webkit-details-marker]:hidden" data-testid="vr2-earlier" style={{ fontFamily: SANS }}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-3">
                <b className="text-[14.5px] font-bold text-[#1C1917]" data-testid="vr2-earlier-title">{title} ({digitsFor(earlier.length, language)})</b>
                <small className="text-[12px] font-bold text-[#2D7FF9]">{SW.tapToListen}</small>
            </summary>
            {earlier.map(rec => {
                const clip = clips.get(rec.id);
                const line = toldLine(rec, language, RS.unsurePart);
                return (
                    <div key={rec.id} className="flex flex-col gap-1.5 border-t border-[#DDE3DA] py-2.5" data-testid={`vr-earlier-${rec.id}`}>
                        <div className="flex flex-wrap gap-[5px]">
                            {rec.timeLabel && <Bd>{rec.timeLabel}</Bd>}
                            <Bd tone="who" testId={`vr-earlier-who-${rec.id}`} you={rec.who.you}>{rec.who.name}</Bd>
                            {rec.typed && <Bd tone="amber" testId={`vr-earlier-typed-${rec.id}`}>{copy.typedTag}</Bd>}
                            <Bd tone={rec.confirmed ? 'green' : 'plain'} testId={`vr-earlier-state-${rec.id}`}>{rec.confirmed ? `✔ ${RS.confirmedBadge}` : RS.notConfirmed}</Bd>
                        </div>
                        {rec.typed
                            ? <TypedNote testId={`vr-earlier-typed-note-${rec.id}`} />
                            : <SavedClip clipKey={clip?.id ?? null} durationSec={clip ? lengthOf(rec.id) : null} playing={playingId === rec.id}
                                onToggle={() => onTogglePlay(rec.id)} testId={`vr-earlier-play-${rec.id}`} />}
                        {rec.wordsWithheld
                            ? <MoneyWordsWithheldCard testId={`vr-earlier-withheld-${rec.id}`} />
                            : rec.transcript && <div className="text-[14.5px] text-[#1C1917]" data-testid={`vr-earlier-words-${rec.id}`}>“{rec.transcript}”</div>}
                        {line && <div className="text-[12.5px] font-bold text-[#5F6B63]" data-testid={`vr-earlier-told-${rec.id}`}>{line}</div>}
                    </div>
                );
            })}
        </details>
    );
};

export default SavedEarlier;
