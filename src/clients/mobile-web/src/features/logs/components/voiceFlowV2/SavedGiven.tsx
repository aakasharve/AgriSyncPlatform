/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 11, step 3) — "तुम्ही काय दिलं": the sprays and fertilisers THIS recording gave, each
 * release as the result screen's own tank (`ProductTank`, one big row per product that opens the `ProductCard`), or its plain
 * box (`ProductBoxCard`) when there is nothing to answer with. Under each tank its combination box (`MixBox`), matched to the
 * line by the result screen's own rule (`lineKeyOfVerdict`). Nothing is worked out here; the record is only read (P7).
 */
import React from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { dayLinesOf, lineKeyOfVerdict } from '../voiceResult/DaySummaryLines';
import { MixBox, type TankVerdict } from '../voiceResult/MixBox';
import type { ProductAnswerKit } from '../voiceResult/ProductCard';
import { ProductBoxCard, ProductTank } from '../voiceResult/ProductRows';
import type { ProductItem } from '../voiceResult/productModel';
import type { DayView } from '../voiceResult/resultModel';

const SANS = "'Noto Sans Devanagari', sans-serif";

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
        <section className="space-y-2" data-testid="vr2-given" style={{ fontFamily: SANS }}>
            <h3 className="m-0 flex flex-wrap items-baseline justify-between gap-1 text-[15px] font-extrabold text-stone-800">
                {W.givenTitle}
                {kit && <span className="text-[12px] font-bold text-stone-500">{W.givenHint}</span>}
            </h3>
            {tanks.map(line => {
                const box = line.box;
                const entry = line.boxEntry;
                if (!box || !entry) return null;
                const mine = verdicts.filter(v => lineKeyOfVerdict(nowLines, v) === line.key);
                return (
                    <div key={line.key} className="space-y-1.5" data-testid={`vr2-given-${line.key}`}>
                        {kit ? <ProductTank box={box} logId={entry.logId} kit={kit} onOpen={onOpen} /> : <ProductBoxCard box={box} />}
                        {mine.map((v, i) => <MixBox key={`${v.logId}:${v.hostEventId}:${i}`} verdict={v} />)}
                    </div>
                );
            })}
        </section>
    );
};

export default SavedGiven;
