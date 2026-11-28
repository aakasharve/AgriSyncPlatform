/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 9) — the saved screen's eight parts, each with what he said or the red "सांगितलं नाही".
 *
 * Re-uses the result screen's own pieces: the parts and their tints (`PARTS`), the icons (`PartIcon`), the names (`partNameIn`)
 * and an entry's text as recorded (`entryText`). Two columns, so the values are readable at 320 px, drawn with the approved design's
 * sizes and colours (`.rb-sec.b8`, `.b8g`, `.b8t`; F3): the औषध / खत tile spans the row and the grid packs densely. Nothing is summed or worked out (P4): a told part shows the day's newest verified entry as it was recorded, and "+N"
 * counts the screen's own rows. A part he mentioned that the server could not find in his words is "स्पष्ट समजू शकले नाही" (amber,
 * not a button: saying it again would record it twice — the rule of `ResultHero.tsx`). An untold part is a real red button
 * that opens the ONE mic for that part (`onTellMore`).
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1 + B3) — `look="rows"`: the same reading drawn as the final design's
 * rows under "यातून काय समजलं" (result-v12-final.html `.ar2`): only the parts told, each value big with HIS verified phrases under it
 * (`entry.quote`, his transcript's own stretch), the stoppage only when told, then the red buttons. The default tiles are unchanged.
 */
import React from 'react';
import { HelpCircle } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { PartIcon } from '../voiceResult/HisWords';
import { entryText, partNameIn } from '../voiceResult/partNames';
import { PARTS, type DayView, type PartEntry, type PartKey } from '../voiceResult/resultModel';
import { useResultStr } from '../voiceResult/resultStrings';
import { RbSec, SaidLine, Tick } from './savedBits';
import { CategoryIcon } from '../shramsathi/understandingRing/CategoryIcon';

/** The design's `.b8t` frame, and its icon tile (`.bi`). */
const TILE = 'flex min-h-[58px] min-w-0 items-center gap-[7px] rounded-[14px] px-2 py-1.5 text-left text-[#1C1917]';
const ICON = 'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-white/80';
const NAME = 'block text-[11.5px] font-extrabold text-[#57534E]';
const VALUE = 'block text-[13.5px] font-extrabold leading-[1.25] [overflow-wrap:anywhere]';

export interface SavedPartsGridProps {
    day: DayView;
    /** Opens the ONE mic for an untold part. In the `rows` look, absent = untold parts are not drawn (a talk opened from the list asks for nothing). */
    onTellMore?: (part: PartKey) => void;
    /**
     * `tiles` (default): the eight parts in two columns, as before. `rows` (the final design, result-v12-final.html `.ar2`): one full-width
     * row per part this day TOLD, its value big and HIS OWN words under it; the stoppage only when one was told; then each untold part
     * as the same red button (only with `onTellMore`). No heading of its own: it sits under "यातून काय समजलं".
     */
    look?: 'tiles' | 'rows';
    /** Parts drawn elsewhere on the screen (the products of "यातून काय समजलं"), left out of the `rows` look. */
    skip?: readonly PartKey[];
}

/** His verified phrases for a part (each piece of a phrase with a gap on its own), as recorded. */
const wordsOf = (entries: readonly PartEntry[]): string[] =>
    entries.filter(e => e.verified).flatMap(e => (e.quoteParts && e.quoteParts.length > 0 ? e.quoteParts : e.quote ? [e.quote] : []));

/** An untold part: the red "सांगितलं नाही" button that opens the ONE mic for it (`.b8t.miss`). */
const UntoldTile: React.FC<{ part: PartKey; wide?: boolean; onTellMore?: (part: PartKey) => void }> = ({ part, wide = false, onTellMore }) => {
    const RS = useResultStr();
    const name = partNameIn(part, useOptionalLanguage()?.language);
    return (
        <button type="button" onClick={() => onTellMore?.(part)} data-testid={`vr2-part-${part}`} data-told="no"
            aria-label={`${name} — ${RS.noneYet}. ${RS.tellMore}`}
            className={`${TILE} border-2 border-[#E5484D] bg-[#FDECEC] active:scale-95 ${wide ? 'col-span-2' : ''}`}>
            <span className={`${ICON} border-[1.5px] border-[#E5484D]`}><PartIcon part={part} size={20} /></span>
            <span className="min-w-0 flex-1">
                <span className={NAME}>{name}</span>
                <span className={`${VALUE} text-[#B4232A]`}>{RS.noneYet}</span>
            </span>
        </button>
    );
};

/** The final design's row frame (`.ar2`): emerald-50, the emerald left edge, a tinted icon square, the small name and the big value. */
const RowFrame: React.FC<{ testId: string; told: string; tone?: 'told' | 'unsure'; icon: React.ReactNode; tint: string; name: string; children?: React.ReactNode; said?: React.ReactNode }> = ({
    testId, told, tone = 'told', icon, tint, name, children, said,
}) => (
    <div data-testid={testId} data-told={told}
        className={`flex flex-col gap-2 rounded-xl p-2.5 text-[#1C1917] ${tone === 'unsure' ? 'border-2 border-amber-300 bg-amber-50' : 'border-l-[6px] border-l-[#059669] bg-[#ECFDF5]'}`}>
        <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl" style={{ background: tint }}>{icon}</span>
            <span className="min-w-0 flex-1">
                <small className="block text-[13px] font-semibold leading-[1.3] text-[#57534E]">{name}</small>
                {children}
            </span>
            {tone === 'unsure' && <HelpCircle size={18} className="shrink-0 text-amber-600" aria-hidden="true" />}
        </div>
        {said}
    </div>
);

const ROW_VALUE = 'block text-[22px] font-extrabold leading-[1.25] [overflow-wrap:anywhere]';

const PartRows: React.FC<{ day: DayView; onTellMore?: (part: PartKey) => void; skip: readonly PartKey[] }> = ({ day, onTellMore, skip }) => {
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    const W = voiceFlowWords(language);
    const missing = new Set(day.missing);
    const unsure = new Set(day.unsure);
    const partial = new Set(day.partial);
    const left = new Set(skip);
    const missingAmount = day.byPart.inputs.some(e => e.verified && (e.products?.items ?? []).some(i => !i.amount));
    const told = PARTS.filter(p => !left.has(p.key) && !missing.has(p.key) && day.byPart[p.key].length > 0);
    const untold = onTellMore ? PARTS.filter(p => !left.has(p.key) && missing.has(p.key)) : [];
    const blocker = day.blockersNow.find(e => e.verified) ?? day.blockersNow[0];
    if (told.length === 0 && untold.length === 0 && !blocker) return null;
    return (
        <div className="flex flex-col gap-2" data-testid="vr2-parts" data-look="rows">
            {told.map(p => {
                const name = partNameIn(p.key, language);
                const icon = <PartIcon part={p.key} size={24} />;
                if (unsure.has(p.key)) {
                    return (
                        <RowFrame key={p.key} testId={`vr2-part-${p.key}`} told="unsure" tone="unsure" icon={icon} tint={p.tint} name={name}>
                            <b className={`${ROW_VALUE} text-[18px] text-amber-900`}>{RS.unsurePart}</b>
                        </RowFrame>
                    );
                }
                const entries = day.byPart[p.key];
                const shown = entries.find(e => e.verified) ?? entries[0];
                const text = shown ? entryText(shown, language, true) : '';
                const more = Math.max(0, entries.length - 1);
                return (
                    <RowFrame key={p.key} testId={`vr2-part-${p.key}`} told={partial.has(p.key) ? 'partial' : 'yes'} icon={icon} tint={p.tint} name={name}
                        said={<SaidLine quotes={wordsOf(entries)} tint={p.tint} className="ml-[50px]" testId={`vr2-part-said-${p.key}`} />}>
                        {text && <b className={ROW_VALUE} data-testid={`vr2-part-value-${p.key}`}>{text}</b>}
                        {(partial.has(p.key) || missingAmount) && p.key === 'inputs' && <span className="block text-[12.5px] font-bold text-amber-800" data-testid="vr2-part-detail-inputs">{RS.giveHowMuch}</span>}
                        {more > 0 && <span className="block text-[12.5px] font-bold text-[#57534E]">{digitsFor(`+${more}`, language)}</span>}
                    </RowFrame>
                );
            })}
            {blocker && (
                <RowFrame testId="vr2-part-blockers" told={blocker.verified ? 'yes' : 'unsure'} tone={blocker.verified ? 'told' : 'unsure'}
                    icon={<CategoryIcon name="blockers" size={24} />} tint="#FFE4D6" name={W.blockerTitle}
                    said={blocker.verified ? <SaidLine quotes={day.blockersNow.filter(b => b.verified && b.quote).map(b => b.quote as string)} tint="#FFE4D6" className="ml-[50px]" testId="vr2-part-said-blockers" /> : undefined}>
                    <b className={ROW_VALUE} data-testid="vr2-part-value-blockers">{blocker.value ?? blocker.quote ?? ''}</b>
                    {day.blockersNow.length > 1 && <span className="block text-[12.5px] font-bold text-[#57534E]">{digitsFor(`+${day.blockersNow.length - 1}`, language)}</span>}
                </RowFrame>
            )}
            {untold.length > 0 && (
                <div className="grid grid-cols-2 items-start gap-1.5" data-testid="vr2-parts-untold">
                    {untold.map(p => <UntoldTile key={p.key} part={p.key} onTellMore={onTellMore} />)}
                </div>
            )}
        </div>
    );
};

const PartTiles: React.FC<{ day: DayView; onTellMore?: (part: PartKey) => void }> = ({ day, onTellMore }) => {
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    const W = voiceFlowWords(language);
    const missing = new Set(day.missing);
    const unsure = new Set(day.unsure);
    const partial = new Set(day.partial);
    // F1: a product Sathi understood without its amount ("0-52-34", no dose) is shown as understood AND the missing amount is named.
    const missingAmount = day.byPart.inputs.some(e => e.verified && (e.products?.items ?? []).some(i => !i.amount));
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
                    if (missing.has(p.key)) return <UntoldTile key={p.key} part={p.key} wide={p.key === 'inputs'} onTellMore={onTellMore} />;
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
                        <span key={p.key} data-testid={`vr2-part-${p.key}`} data-told={partial.has(p.key) ? 'partial' : 'yes'} className={`${TILE} ${wide}`} style={{ background: p.tint }}>
                            <span className={ICON}><PartIcon part={p.key} size={20} /></span>
                            <span className="min-w-0 flex-1">
                                <span className={NAME}>{name}</span>
                                {text && <span className={VALUE} data-testid={`vr2-part-value-${p.key}`}>{text}</span>}
                                {(partial.has(p.key) || missingAmount) && p.key === 'inputs' && <span className="block text-[11.5px] font-bold text-amber-800" data-testid="vr2-part-detail-inputs">{RS.giveHowMuch}</span>}
                                {more > 0 && <span className="block text-[11.5px] font-bold text-[#57534E]">{digitsFor(`+${more}`, language)}</span>}
                            </span>
                            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#16A34A]" aria-hidden="true"><Tick size={11} /></span>
                        </span>
                    );
                })}
                <BlockerTile day={day} language={language} />
            </div>
        </RbSec>
    );
};

export const SavedPartsGrid: React.FC<SavedPartsGridProps> = ({ day, onTellMore, look = 'tiles', skip = [] }) => (
    look === 'rows' ? <PartRows day={day} onTellMore={onTellMore} skip={skip} /> : <PartTiles day={day} onTellMore={onTellMore} />
);

/**
 * Founder 2026-11-23: "add Disturbance - अडथळा". What stopped or hindered the work (rain, power, workers who did not come) as
 * one more tile, from the recording's own stoppage entries (`day.blockersNow`), shown as recorded. Not told: a plain grey tile,
 * never the red "सांगितलं नाही" — a day without a disturbance is a normal day (the ring's rule since 2026-10-25), so it is not
 * counted in "८ पैकी N भरले" and asks for nothing.
 */
const BlockerTile: React.FC<{ day: DayView; language: string | undefined }> = ({ day, language }) => {
    const W = voiceFlowWords(language);
    const entries = day.blockersNow;
    const shown = entries.find(e => e.verified) ?? entries[0];
    if (!shown) {
        return (
            <span data-testid="vr2-part-blockers" data-told="no" className={`${TILE} border border-dashed border-stone-300 bg-stone-50`}>
                <span className={ICON}><CategoryIcon name="blockers" size={20} /></span>
                <span className="min-w-0 flex-1">
                    <span className={NAME}>{W.blockerTitle}</span>
                    <span className={`${VALUE} font-bold text-stone-500`}>{W.blockerNone}</span>
                </span>
            </span>
        );
    }
    const unsure = !shown.verified;
    return (
        <span data-testid="vr2-part-blockers" data-told={unsure ? 'unsure' : 'yes'}
            className={`${TILE} ${unsure ? 'border-2 border-amber-300 bg-amber-50' : ''}`} style={unsure ? undefined : { background: '#FFE4D6' }}>
            <span className={ICON}><CategoryIcon name="blockers" size={20} /></span>
            <span className="min-w-0 flex-1">
                <span className={NAME}>{W.blockerTitle}</span>
                <span className={VALUE} data-testid="vr2-part-value-blockers">{shown.value ?? shown.quote ?? ''}</span>
                {entries.length > 1 && <span className="block text-[11.5px] font-bold text-[#57534E]">{digitsFor(`+${entries.length - 1}`, language)}</span>}
            </span>
            {unsure ? <HelpCircle size={18} className="shrink-0 text-amber-600" aria-hidden="true" />
                : <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#16A34A]" aria-hidden="true"><Tick size={11} /></span>}
        </span>
    );
};

export default SavedPartsGrid;
