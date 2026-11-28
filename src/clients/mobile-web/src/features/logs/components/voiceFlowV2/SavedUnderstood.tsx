/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1 + B3) — "यातून काय समजलं" of ONE talk, as the final design draws it
 * (result-v12-final.html `understood()`): the sprays and fertilisers FIRST (`SavedGiven`, look `row`: each release with its water and
 * tank count, his words, then its products, each with his words; the combination box under it), then every other part the talk told
 * (`SavedPartsGrid`, look `rows`: the value big and his words under it), then — on the talk he just made — each part the DAY has not
 * told yet, as the red button that opens the ONE mic for it.
 *
 * Re-uses the saved screen's own pieces; nothing is worked out here. The औषध / खत row of the parts is left out only when every input
 * entry of the talk is already drawn as a release above (an input with nothing to show as products keeps its row: an understood item
 * never vanishes).
 */
import React from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { dayLinesOf } from '../voiceResult/DaySummaryLines';
import type { TankVerdict } from '../voiceResult/MixBox';
import type { ProductAnswerKit } from '../voiceResult/ProductCard';
import type { ProductItem } from '../voiceResult/productModel';
import type { DayView, PartKey } from '../voiceResult/resultModel';
import { finalResultWords } from './finalResultWords';
import SavedGiven from './SavedGiven';
import SavedPartsGrid from './SavedPartsGrid';

export interface SavedUnderstoodProps {
    /** The talk read as a day (`talkDay.talkDayOf`). */
    talk: DayView;
    kit?: ProductAnswerKit;
    verdicts: readonly TankVerdict[];
    onOpenProduct: (item: ProductItem, logId: string) => void;
    /** Opens the ONE mic for an untold part; absent = untold parts are not drawn. */
    onTellMore?: (part: PartKey) => void;
    testId?: string;
}

export const SavedUnderstood: React.FC<SavedUnderstoodProps> = ({ talk, kit, verdicts, onOpenProduct, onTellMore, testId = 'vr2-understood' }) => {
    const language = useOptionalLanguage()?.language;
    const FW = finalResultWords(language);
    const lines = dayLinesOf(talk, language, 'now');
    const boxed = lines.some(l => l.part === 'inputs' && !!l.box);
    const loose = lines.some(l => l.key === 'inputs');
    const skip: PartKey[] = boxed && !loose ? ['inputs'] : [];
    return (
        <div className="flex flex-col gap-2" data-testid={testId}>
            <div className="text-[12px] font-extrabold leading-[18px] text-[#065F46]">{FW.understood}</div>
            <SavedGiven day={talk} kit={kit} verdicts={verdicts} onOpen={onOpenProduct} look="row" />
            <SavedPartsGrid day={talk} onTellMore={onTellMore} look="rows" skip={skip} />
        </div>
    );
};

export default SavedUnderstood;
