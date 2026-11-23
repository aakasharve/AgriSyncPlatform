/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 9) — the saved screen's eight parts, each with what he said or the red "सांगितलं नाही".
 *
 * Re-uses the result screen's own pieces: the parts and their tints (`PARTS`), the icons (`PartIcon`), the names (`partNameIn`)
 * and an entry's text as recorded (`entryText`). Two columns, so the values are readable at 320 px, drawn with the approved design's
 * sizes and colours (`.rb-sec.b8`, `.b8g`, `.b8t`; F3): the औषध / खत tile spans the row and the grid packs densely. Nothing is summed or worked out (P4): a told part shows the day's newest verified entry as it was recorded, and "+N"
 * counts the screen's own rows. A part he mentioned that the server could not find in his words is "नक्की समजलं नाही" (amber,
 * not a button: saying it again would record it twice — the rule of `ResultHero.tsx`). An untold part is a real red button
 * that opens the ONE mic for that part (`onTellMore`).
 */
import React from 'react';
import { HelpCircle } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { PartIcon } from '../voiceResult/HisWords';
import { entryText, partNameIn } from '../voiceResult/partNames';
import { PARTS, type DayView, type PartKey } from '../voiceResult/resultModel';
import { useResultStr } from '../voiceResult/resultStrings';
import { RbSec, Tick } from './savedBits';

/** The design's `.b8t` frame, and its icon tile (`.bi`). */
const TILE = 'flex min-h-[58px] min-w-0 items-center gap-[7px] rounded-[14px] px-2 py-1.5 text-left text-[#1C1917]';
const ICON = 'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-white/80';
const NAME = 'block text-[11.5px] font-extrabold text-[#57534E]';
const VALUE = 'block text-[13.5px] font-extrabold leading-[1.25] [overflow-wrap:anywhere]';

export interface SavedPartsGridProps {
    day: DayView;
    onTellMore: (part: PartKey) => void;
}

export const SavedPartsGrid: React.FC<SavedPartsGridProps> = ({ day, onTellMore }) => {
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    const W = voiceFlowWords(language);
    const missing = new Set(day.missing);
    const unsure = new Set(day.unsure);
    const filled = PARTS.filter(p => !missing.has(p.key) && !unsure.has(p.key)).length;
    const valueOf = (key: PartKey): { text: string; more: number } => {
        const entries = day.byPart[key];
        const shown = entries.find(e => e.verified) ?? entries[0];
        return { text: shown ? entryText(shown, language, true) : '', more: Math.max(0, entries.length - 1) };
    };
    return (
        <RbSec testId="vr2-parts" title={W.partsTitle} hint={W.partsCount(filled, PARTS.length)} hintTestId="vr2-parts-count">
            <div className="grid grid-flow-row-dense grid-cols-2 items-start gap-1.5">
                {PARTS.map(p => {
                    const name = partNameIn(p.key, language);
                    const wide = p.key === 'inputs' ? 'col-span-2' : '';
                    if (missing.has(p.key)) {
                        return (
                            <button key={p.key} type="button" onClick={() => onTellMore(p.key)} data-testid={`vr2-part-${p.key}`} data-told="no"
                                aria-label={`${name} — ${RS.noneYet}. ${RS.tellMore}`}
                                className={`${TILE} border-2 border-[#E5484D] bg-[#FDECEC] active:scale-95 ${wide}`}>
                                <span className={`${ICON} border-[1.5px] border-[#E5484D]`}><PartIcon part={p.key} size={20} /></span>
                                <span className="min-w-0 flex-1">
                                    <span className={NAME}>{name}</span>
                                    <span className={`${VALUE} text-[#B4232A]`}>{RS.noneYet}</span>
                                </span>
                                <span className="shrink-0 text-[15px]" aria-hidden="true">🎤</span>
                            </button>
                        );
                    }
                    if (unsure.has(p.key)) {
                        return (
                            <span key={p.key} data-testid={`vr2-part-${p.key}`} data-told="unsure" className={`${TILE} border-2 border-amber-300 bg-amber-50 ${wide}`}>
                                <span className={ICON}><PartIcon part={p.key} size={20} /></span>
                                <span className="min-w-0 flex-1">
                                    <span className={NAME}>{name}</span>
                                    <span className={`${VALUE} text-amber-900`}>{RS.unsurePart}</span>
                                </span>
                                <HelpCircle size={18} className="shrink-0 text-amber-600" aria-hidden="true" />
                            </span>
                        );
                    }
                    const { text, more } = valueOf(p.key);
                    return (
                        <span key={p.key} data-testid={`vr2-part-${p.key}`} data-told="yes" className={`${TILE} ${wide}`} style={{ background: p.tint }}>
                            <span className={ICON}><PartIcon part={p.key} size={20} /></span>
                            <span className="min-w-0 flex-1">
                                <span className={NAME}>{name}</span>
                                {text && <span className={VALUE} data-testid={`vr2-part-value-${p.key}`}>{text}</span>}
                                {more > 0 && <span className="block text-[11.5px] font-bold text-[#57534E]">{digitsFor(`+${more}`, language)}</span>}
                            </span>
                            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#16A34A]" aria-hidden="true"><Tick size={11} /></span>
                        </span>
                    );
                })}
            </div>
        </RbSec>
    );
};

export default SavedPartsGrid;
