/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 11, step 3; design-fidelity pass F3) — "तुम्ही काय दिलं": the sprays and fertilisers THIS
 * recording gave, in the approved design's white section (`.rb-sec` with "दाबा आणि घटक बघा"), each release as its tank
 * (`SavedTank`: one coloured row per product that opens the product card; plain rows when there is nothing to answer with).
 * Under each tank its combination box (`MixBox`), matched to the line by the result screen's own rule (`lineKeyOfVerdict`).
 * Nothing is worked out here; the record is only read (P7).
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1) — `look="row"`: the same releases as the FIRST rows of "यातून काय
 * समजलं" (the final design), with no section of their own, each with its tank count (`tankFacts.tankCountOf`: the parse's, else his
 * words', else none — P4) and HIS words under the release and under each product (stretches of his transcript, P8).
 */
import React from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { DailyLog } from '../../../../types';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { dayLinesOf, lineKeyOfVerdict } from '../voiceResult/DaySummaryLines';
import { MixBox, type TankVerdict } from '../voiceResult/MixBox';
import type { ProductAnswerKit } from '../voiceResult/ProductCard';
import type { ProductBox } from '../voiceResult/productModel';
import type { DayView } from '../voiceResult/resultModel';
import { RbSec } from './savedBits';
import { SavedTank, type OpenProduct, type TankWords } from './SavedProducts';
import { productWordsOf, tankCountOf, waterWordsOf } from './tankFacts';

export interface SavedGivenProps {
    day: DayView;
    kit?: ProductAnswerKit;
    verdicts: readonly TankVerdict[];
    onOpen: OpenProduct;
    /** `box` (default): its own white section, as before. `row`: the releases only, as rows of "यातून काय समजलं" (the final design). */
    look?: 'box' | 'row';
}

/** His words for a log of this screen: the recording's transcript (the log that carries his words), none when they are withheld. */
const transcriptOf = (day: DayView, logId: string): string => {
    const rec = day.recordingByLog.get(logId) ?? day.current.find(r => r.logIds.includes(logId));
    if (!rec || rec.wordsWithheld) return '';
    return rec.transcript || day.current.find(r => !!r.transcript && !r.wordsWithheld)?.transcript || '';
};

/** The log a release rides on, as this phone holds it. */
const logOf = (day: DayView, kit: ProductAnswerKit | undefined, logId: string): DailyLog | undefined =>
    kit?.logById.get(logId) ?? [...day.current, ...day.earlier].find(r => r.log.id === logId)?.log;

/** The release's tank count and his words (the final design's row and the product flash card read the same). */
export const tankWordsOf = (day: DayView, kit: ProductAnswerKit | undefined, logId: string, box: ProductBox): TankWords => {
    const transcript = transcriptOf(day, logId);
    const tanks = tankCountOf(logOf(day, kit, logId), box.id, transcript);
    return {
        tanks: tanks?.count ?? null,
        said: [...waterWordsOf(box, transcript), ...(tanks?.words ? [tanks.words] : [])],
        saidOf: item => productWordsOf(item, transcript),
    };
};

export const SavedGiven: React.FC<SavedGivenProps> = ({ day, kit, verdicts, onOpen, look = 'box' }) => {
    const language = useOptionalLanguage()?.language;
    const W = voiceFlowWords(language);
    const nowLines = dayLinesOf(day, language, 'now');
    const tanks = nowLines.filter(l => l.box && l.boxEntry);
    if (tanks.length === 0) return null;
    const body = tanks.map(line => {
        const box = line.box;
        const entry = line.boxEntry;
        if (!box || !entry) return null;
        const mine = verdicts.filter(v => lineKeyOfVerdict(nowLines, v) === line.key);
        return (
            <div key={line.key} className="space-y-1.5" data-testid={`vr2-given-${line.key}`}>
                <SavedTank box={box} logId={entry.logId} kit={kit} onOpen={onOpen}
                    {...(look === 'row' ? { look: 'row' as const, words: tankWordsOf(day, kit, entry.logId, box) } : {})} />
                {mine.map((v, i) => <MixBox key={`${v.logId}:${v.hostEventId}:${i}`} verdict={v} />)}
            </div>
        );
    });
    if (look === 'row') return <div className="flex flex-col gap-2" data-testid="vr2-given" data-look="row">{body}</div>;
    return (
        <RbSec testId="vr2-given" title={W.givenTitle} hint={kit ? W.givenHint : undefined}>
            {body}
        </RbSec>
    );
};

export default SavedGiven;
