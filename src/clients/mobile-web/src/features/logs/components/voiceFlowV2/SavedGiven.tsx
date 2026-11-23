/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 11, step 3; design-fidelity pass F3) — "तुम्ही काय दिलं": the sprays and fertilisers THIS
 * recording gave, in the approved design's white section (`.rb-sec` with "दाबा आणि घटक बघा"), each release as its tank
 * (`SavedTank`: one coloured row per product that opens the product card; plain rows when there is nothing to answer with).
 * Under each tank its combination box (`MixBox`), matched to the line by the result screen's own rule (`lineKeyOfVerdict`).
 * Nothing is worked out here; the record is only read (P7).
 */
import React from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { dayLinesOf, lineKeyOfVerdict } from '../voiceResult/DaySummaryLines';
import { MixBox, type TankVerdict } from '../voiceResult/MixBox';
import type { ProductAnswerKit } from '../voiceResult/ProductCard';
import type { ProductItem } from '../voiceResult/productModel';
import type { DayView } from '../voiceResult/resultModel';
import { RbSec } from './savedBits';
import { SavedTank } from './SavedProducts';

export interface SavedGivenProps {
    day: DayView;
    kit?: ProductAnswerKit;
    verdicts: readonly TankVerdict[];
    onOpen: (item: ProductItem, logId: string) => void;
}

export const SavedGiven: React.FC<SavedGivenProps> = ({ day, kit, verdicts, onOpen }) => {
    const language = useOptionalLanguage()?.language;
    const W = voiceFlowWords(language);
    const nowLines = dayLinesOf(day, language, 'now');
    const tanks = nowLines.filter(l => l.box && l.boxEntry);
    if (tanks.length === 0) return null;
    return (
        <RbSec testId="vr2-given" title={W.givenTitle} hint={kit ? W.givenHint : undefined}>
            {tanks.map(line => {
                const box = line.box;
                const entry = line.boxEntry;
                if (!box || !entry) return null;
                const mine = verdicts.filter(v => lineKeyOfVerdict(nowLines, v) === line.key);
                return (
                    <div key={line.key} className="space-y-1.5" data-testid={`vr2-given-${line.key}`}>
                        <SavedTank box={box} logId={entry.logId} kit={kit} onOpen={onOpen} />
                        {mine.map((v, i) => <MixBox key={`${v.logId}:${v.hostEventId}:${i}`} verdict={v} />)}
                    </div>
                );
            })}
        </RbSec>
    );
};

export default SavedGiven;
