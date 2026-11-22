/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 1; founder 2026-11-06, DFES-simple-day-preview.html) - the
 * simple form of the result screen: ONE tappable line per part of the day, nothing expanded. A tap opens only that line.
 *
 *   - A line is a part the day holds something about (`day.byPart`), in the parts' own order and tints. A sprayed or dripped
 *     release is its own line ("फवारणी", "खत · ठिबकने"), because the products given in one tank belong together; its open
 *     body is the Option 3 product rows and the combination box. Every other part opens to its entries, each tied to the time
 *     and the speaker of the recording it came from.
 *   - Nothing is summed or worked out here (P4): a line says what the day's latest verified entry says, as it was recorded.
 *   - The red mix flag sits on the line that holds the wrong mix; the banner on top of the screen opens that line.
 *   - Open lines are the parent's state, so the banner can open one. This file only reads the record (P7).
 */
import React from 'react';
import { ChevronDown, OctagonAlert } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { DayEntries, LegacyNote, TimePill, TypedTag, WhoChip } from './DayParts';
import { PartIcon } from './HisWords';
import { MixBox, type TankVerdict } from './MixBox';
import { partNameIn } from './partNames';
import type { ProductAnswerKit } from './ProductCard';
import { ProductBoxCard, ProductTank } from './ProductRows';
import { amountText, productName, showsProducts, type ProductBox, type ProductItem } from './productModel';
import { resultCopy } from './resultCopy';
import { PARTS, partMeta, type DayView, type PartEntry, type PartKey } from './resultModel';
import { useResultStr } from './resultStrings';

export interface DayLine {
    key: string;
    part: PartKey;
    title: string;
    /** What the line says closed. '' = nothing the server could verify (the "not sure" mark stands in). */
    summary: string;
    entries: PartEntry[];
    /** Set for a spray / drip release: its products, as recorded. */
    box?: ProductBox;
    boxEntry?: PartEntry;
    /** This recording added to it ("नवीन"). */
    touched: boolean;
}

const shownNames = (box: ProductBox, language: string | undefined): string =>
    box.items.map(i => productName(i, language)).filter(Boolean).join(' + ') || box.items.map(i => amountText(i.amount, language, true)).filter(Boolean).join(' + ');

/**
 * Which entries a list of lines is made of: the whole day (`day`, the default), or ONLY the recording he just made (`now`, lane
 * RWF: "show the buckets identified on that particular voice log", founder 2026-11-20). In `now` nothing is tagged "नवीन": all of
 * it is new.
 */
export type LineScope = 'day' | 'now';

/** The lines of a day, in the parts' order. Pure. */
export function dayLinesOf(day: DayView, language: string | undefined, scope: LineScope = 'day'): DayLine[] {
    const copy = resultCopy(language);
    const nowIds = new Set(day.current.map(r => r.id));
    const lines: DayLine[] = [];
    for (const m of PARTS) {
        const entries = scope === 'now' ? day.byPart[m.key].filter(e => nowIds.has(e.logId)) : day.byPart[m.key];
        if (entries.length === 0) continue;
        const headline = (list: readonly PartEntry[]): string => {
            const last = list.find(e => e.verified);
            return last ? (last.value ?? last.quote ?? '') : '';
        };
        if (m.key === 'inputs') {
            const boxed = entries.filter(e => e.verified && showsProducts(e.products, language));
            const rest = entries.filter(e => !boxed.includes(e));
            for (const e of boxed) {
                const box = e.products as ProductBox;
                lines.push({
                    key: `inputs:${e.id}`, part: 'inputs',
                    title: box.kind === 'spray' ? copy.spray : box.kind === 'drip' ? copy.drip : copy.products,
                    summary: shownNames(box, language), entries: [e], box, boxEntry: e,
                    touched: scope === 'day' && nowIds.has(e.logId),
                });
            }
            if (rest.length > 0) {
                lines.push({
                    key: 'inputs', part: 'inputs', title: partNameIn('inputs', language), summary: headline(rest), entries: rest,
                    touched: scope === 'day' && rest.some(e => nowIds.has(e.logId)),
                });
            }
            continue;
        }
        lines.push({
            key: `part:${m.key}`, part: m.key, title: partNameIn(m.key, language), summary: headline(entries), entries,
            touched: scope === 'day' && day.touchedNow.has(m.key),
        });
    }
    return lines;
}

/** The line a wrong mix sits under: its own release when that has a line, else the day's general sprays / fertiliser line. */
export function lineKeyOfVerdict(lines: readonly DayLine[], v: TankVerdict): string | undefined {
    return lines.find(l => l.key === `inputs:${v.hostEventId}`)?.key
        ?? lines.find(l => l.key === 'inputs')?.key
        ?? lines.find(l => l.part === 'inputs')?.key;
}

export interface DaySummaryLinesProps {
    day: DayView;
    /** Lane RWF: `now` = only this recording's parts (the default list under his words); `day` = the whole day (the folded list lower down). */
    scope?: LineScope;
    open: ReadonlySet<string>;
    onToggle: (key: string) => void;
    /** Tank verdicts of the day's records (derived on read); only a line that holds one shows a box. */
    verdicts?: readonly TankVerdict[];
    kit?: ProductAnswerKit;
    onOpenProduct?: (item: ProductItem, logId: string) => void;
}

export const DaySummaryLines: React.FC<DaySummaryLinesProps> = ({ day, scope = 'now', open, onToggle, verdicts = [], kit, onOpenProduct }) => {
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    const lines = dayLinesOf(day, language, scope);
    // The two lists never share an open line: the whole-day list keeps its own keys and its own test ids (`vr-day-...`).
    const day$ = scope === 'day';
    const keyOf = (key: string): string => (day$ ? `day:${key}` : key);
    const tid = (what: string, key?: string): string => `vr-${day$ ? 'day-' : ''}${what}${key === undefined ? '' : `-${key}`}`;
    const nowIds = new Set(day.current.map(r => r.id));
    const hostOf = (v: TankVerdict) => lineKeyOfVerdict(lines, v);
    return (
        <div className="divide-y divide-stone-100" data-testid={day$ ? 'vr-day-lines-list' : 'vr-lines'}>
            {lines.map(line => {
                const m = partMeta(line.part);
                const isOpen = open.has(keyOf(line.key));
                const mine = verdicts.filter(v => hostOf(v) === line.key);
                const red = mine.some(v => v.result.state === 'red');
                const rec = line.boxEntry ? day.recordingByLog.get(line.boxEntry.logId) : undefined;
                return (
                    <section key={line.key} data-testid={tid('line', line.key)} data-open={isOpen ? 'yes' : 'no'} data-part={line.part} data-touched={line.touched ? 'yes' : 'no'}>
                        <button type="button" onClick={() => onToggle(keyOf(line.key))} aria-expanded={isOpen} data-testid={tid('line-row', line.key)}
                            className="flex min-h-[54px] w-full items-center gap-2.5 px-1 py-2 text-left">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: m.tint }}><PartIcon part={line.part} size={20} /></span>
                            <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-extrabold text-stone-500">
                                    {line.title}
                                    {red && (
                                        <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-600 px-2 py-0.5 text-[11.5px] font-extrabold text-white" data-testid={tid('line-red', line.key)}>
                                            <OctagonAlert size={13} aria-hidden="true" />{resultCopy(language).mixBannerOne}
                                        </span>
                                    )}
                                    {line.touched && <span className="rounded-full bg-emerald-700 px-1.5 py-0.5 text-[11.5px] font-extrabold text-white">{RS.newTag}</span>}
                                </span>
                                <span className="block truncate text-[15px] font-extrabold leading-snug text-stone-900" data-testid={tid('line-head', line.key)}>
                                    {line.summary || <span className="text-[13px] font-bold text-amber-800">{RS.unsure}</span>}
                                </span>
                            </span>
                            <ChevronDown size={18} className={`shrink-0 text-stone-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                        </button>
                        {isOpen && (
                            <div className="space-y-1.5 pb-3 pl-[46px] pr-1" data-testid={tid('line-body', line.key)}>
                                {line.box && line.boxEntry ? (
                                    <>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {rec && <TimePill label={rec.timeLabel} strong={nowIds.has(line.boxEntry.logId)} />}
                                            {rec && day.speakers.length > 1 && <WhoChip who={rec.who} />}
                                            {rec?.typed && <TypedTag />}
                                        </div>
                                        {rec?.legacyPartial && <LegacyNote testId={tid('line-legacy', line.key)} />}
                                        {kit && onOpenProduct
                                            ? <ProductTank box={line.box} logId={line.boxEntry.logId} kit={kit} onOpen={onOpenProduct} />
                                            : <ProductBoxCard box={line.box} />}
                                    </>
                                ) : (
                                    <DayEntries part={line.part} entries={line.entries} byLog={day.recordingByLog} showWho={day.speakers.length > 1} nowIds={nowIds} />
                                )}
                                {mine.map((v, i) => <MixBox key={`${v.logId}:${v.hostEventId}:${i}`} verdict={v} />)}
                            </div>
                        )}
                    </section>
                );
            })}
        </div>
    );
};

export default DaySummaryLines;
