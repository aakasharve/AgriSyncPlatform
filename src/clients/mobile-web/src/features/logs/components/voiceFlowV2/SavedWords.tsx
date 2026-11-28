/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (design-fidelity pass F3) — his words and why Sathi understood them, in ONE white section as the
 * approved design draws it (`.rb-sec` "तुमचं बोलणं", `.wtxt` tinted words, `.why` / `.wg` / `.wt` / `.wc` / `.wq` / `.wr` / `.ww`,
 * `.unclr`). Open from the start (no fold): the clip is in the card above.
 *
 * Every piece is the result screen's own reading (`HisWords`): only verified phrases are tinted (`markTranscript`), a tile per part
 * his words were marked with (`phrasesByPart`), his deciding phrase as recorded, the ONE fixed reason line and what Sathi noted
 * (`wroteOf`). Tapping a tile opens it and dims every other word; tapping it again brings them back. Words withheld by the money
 * rule show the rule card instead (MU-3). Nothing is invented here.
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1) — `look="final"`: the final design's "तुमचं बोलणं" inside the talk card
 * (result-v12-final.html `words()`): the same tinted words in its serif, each tinted phrase followed by its part's icon tag, and no
 * why-tiles (his own words now sit under each value of "यातून काय समजलं"). The default look is unchanged.
 */
import { Lightbulb } from 'lucide-react';
import React, { useState } from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import MoneyWordsWithheldCard from '../originalVoice/MoneyWordsWithheldCard';
import { PartIcon, SHOWN_PHRASES, wroteOf } from '../voiceResult/HisWords';
import { partNameIn } from '../voiceResult/partNames';
import { resultCopy } from '../voiceResult/resultCopy';
import { markTranscript, partMeta, phrasesByPart, type PartEntry, type PartKey, type WordRun } from '../voiceResult/resultModel';
import { useResultStr } from '../voiceResult/resultStrings';
import { RbSec } from './savedBits';

/** The final design's words (`.wd`): Noto Serif Devanagari, 18 px on a 31.5 px line. */
const SERIF = "'Noto Serif Devanagari', serif";

/**
 * His words, each verified phrase in its part's tint (`.wtxt .pw.tinted`); `focus` keeps one part bright. `tags` (the final design's
 * `.wtag`): the part's icon in a small round tag right after each tinted phrase.
 */
const TintedWords: React.FC<{ runs: readonly WordRun[]; focus: PartKey | null; tags?: boolean }> = ({ runs, focus, tags = false }) => (
    <p className={tags ? 'm-0 text-[18px] font-normal leading-[31.5px] text-[#292524]' : 'm-0 text-[16.5px] font-medium leading-[1.85] text-[#1C1917]'}
        style={tags ? { fontFamily: SERIF } : undefined} data-testid="vr2-words-text">
        {runs.map((r, i) => {
            const parts = r.part ? [r.part, ...(r.also ?? [])] : [];
            const dim = focus != null && !parts.includes(focus);
            if (!r.part) return <span key={i} className={`motion-safe:transition-opacity ${dim ? 'opacity-30' : ''}`}>{r.text}</span>;
            const tint = partMeta(r.part).tint;
            return (
                <React.Fragment key={i}>
                    <mark data-part={r.part} data-parts={parts.join(' ')} data-dim={dim ? 'yes' : 'no'}
                        className={`rounded-md px-[3px] py-px text-inherit shadow-[inset_0_-2px_0_rgba(0,0,0,0.12)] motion-safe:transition-opacity ${dim ? 'opacity-30' : ''}`}
                        style={{ background: tint }}>{r.text}</mark>
                    {tags && (
                        <span className="mx-0.5 inline-grid h-[26px] w-[26px] place-items-center rounded-full align-middle" style={{ background: tint }}
                            aria-hidden="true" data-testid="vr2-words-tag" data-part={r.part}>
                            <PartIcon part={r.part} size={18} />
                        </span>
                    )}
                </React.Fragment>
            );
        })}
    </p>
);

/** "श्रम साथीला हे का समजले?" (`.why`): one tile per part, the first open; the open part's phrases in one card. */
const WhyTiles: React.FC<{ runs: readonly WordRun[]; entries: readonly PartEntry[]; focus: PartKey | null; onFocus: (p: PartKey | null) => void }> = ({
    runs, entries, focus, onFocus,
}) => {
    const language = useOptionalLanguage()?.language;
    const copy = resultCopy(language);
    const groups = phrasesByPart(runs);
    const [open, setOpen] = useState<PartKey | null>(null);
    const [all, setAll] = useState<Partial<Record<PartKey, boolean>>>({});
    if (groups.length === 0) return null;
    const shown = groups.find(g => g.part === open) ?? groups[0];
    const tint = partMeta(shown.part).tint;
    const expanded = !!all[shown.part];
    const said = runs.map(r => r.text).join('');
    const firstAt = (e: PartEntry): number => said.indexOf((e.quoteParts ?? [e.quote ?? ''])[0]);
    const items = entries.filter(e => e.part === shown.part && !!e.quote).sort((a, b) => firstAt(a) - firstAt(b));
    const phrases = expanded ? items : items.slice(0, SHOWN_PHRASES);
    const pick = (p: PartKey) => { setOpen(p); onFocus(focus === p && shown.part === p ? null : p); };
    return (
        <div className="mt-2.5" data-testid="vr2-why">
            <div className="text-[17px] font-bold text-[#064E3B]" data-testid="vr-why-heading">{copy.whyHeading}</div>
            <p className="m-0 mt-0.5 text-[13px] font-bold text-[#57534E]">{copy.whySub}</p>
            <p className="m-0 mb-2 text-[12px] font-semibold text-[#78716C]" data-testid="vr-plain-note">{copy.plainWordsNote}</p>
            <div className="grid grid-cols-4 gap-1.5">
                {groups.map(g => {
                    const sel = shown.part === g.part;
                    return (
                        <button key={g.part} type="button" aria-pressed={sel} data-testid={`vr-link-${g.part}`} onClick={() => pick(g.part)}
                            className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border-2 px-0.5 py-1.5 text-center text-[12px] font-extrabold leading-[1.15] text-[#1C1917] ${sel ? 'border-[#292524] shadow-[0_4px_10px_rgba(0,0,0,0.15)]' : 'border-transparent'}`}
                            style={{ background: partMeta(g.part).tint }}>
                            <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-white/80"><PartIcon part={g.part} size={22} /></span>
                            <span>{partNameIn(g.part, language)}</span>
                        </button>
                    );
                })}
            </div>
            <div className="mt-2 flex flex-col gap-3 rounded-[22px] border-2 bg-white p-2.5 shadow-[0_6px_18px_rgba(23,50,31,0.08)]" style={{ borderColor: tint }}
                data-testid="vr-link-card" data-part={shown.part}>
                {phrases.map((entry, i) => {
                    const phrase = entry.quote ?? '';
                    const wrote = wroteOf(entry, language, copy);
                    return (
                        <div key={i} data-testid={`vr-link-phrase-${shown.part}-${i}`}>
                            <div className="rounded-[14px] border border-[#E7E5E4] bg-[#FAFAF9] px-2.5 py-2 text-[16px] font-semibold leading-[1.5] text-[#292524]">
                                <span aria-hidden="true" className="text-[19px] font-black text-[#A8A29E]">“</span>
                                <mark data-testid={`vr-why-cue-${shown.part}-${i}`} className="rounded-md px-1 font-extrabold text-[#1C1917] shadow-[inset_0_-4px_0_rgba(0,0,0,0.12)]"
                                    style={{ background: tint }}>{phrase}</mark>
                                <span aria-hidden="true" className="text-[19px] font-black text-[#A8A29E]">”</span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-1.5 text-[14px] font-bold text-[#44403C]" data-testid={`vr-why-reason-${shown.part}-${i}`}>
                                <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-[#FEF3C7] text-amber-700" aria-hidden="true"><Lightbulb size={14} /></span>
                                <span className="min-w-0">{copy.whyReason}</span>
                            </div>
                            {wrote && wrote !== phrase && (
                                <div className="mt-1.5 flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5" style={{ background: tint }} data-testid={`vr-why-wrote-${shown.part}-${i}`}>
                                    <span className="text-[12px] font-extrabold text-[#44403C]">{copy.wrote}</span>
                                    <b className="text-right text-[16px] font-extrabold">{wrote}</b>
                                </div>
                            )}
                        </div>
                    );
                })}
                {items.length > SHOWN_PHRASES && (
                    <button type="button" onClick={() => setAll(a => ({ ...a, [shown.part]: !expanded }))} data-testid="vr-why-more"
                        className="min-h-[44px] w-full rounded-xl border-2 border-stone-200 text-[14px] font-extrabold text-stone-700 active:scale-[0.99]">
                        {expanded ? copy.less : copy.more(items.length - SHOWN_PHRASES)}
                    </button>
                )}
            </div>
        </div>
    );
};

export interface SavedWordsProps {
    transcript: string;
    wordsWithheld: boolean;
    entries: readonly PartEntry[];
    unclear: readonly string[];
    /** His recording's player (or the typed note), at the top of his words (founder 2026-11-23: meter, then his text). */
    player?: React.ReactNode;
    /**
     * `card` (default): the white section with the why-tiles, as before. `final` (the final design, result-v12-final.html `.lc`): no
     * card of its own (it sits inside the talk card), the small green heading, his words in the design's serif with each part's
     * tag, and no why-tiles: his own words now sit under each value of "यातून काय समजलं" instead.
     */
    look?: 'card' | 'final';
    /** The heading in the `final` look (default "तुमचं बोलणं"). */
    title?: string;
    testId?: string;
}

export const SavedWords: React.FC<SavedWordsProps> = ({ transcript, wordsWithheld, entries, unclear, player, look = 'card', title, testId = 'vr2-words' }) => {
    const RS = useResultStr();
    const copy = resultCopy(useOptionalLanguage()?.language);
    const [focus, setFocus] = useState<PartKey | null>(null);
    const runs = markTranscript(transcript, entries);
    if (!wordsWithheld && runs.length === 0 && unclear.length === 0 && !player) return null;
    if (look === 'final') {
        return (
            <div className="flex flex-col gap-1.5" data-testid={testId} data-look="final">
                <div className="text-[12px] font-extrabold leading-[18px] text-[#065F46]" data-testid={`${testId}-title`}>{title ?? copy.yourWords}</div>
                {player}
                {wordsWithheld ? <MoneyWordsWithheldCard testId="vr-words-withheld" /> : runs.length > 0 && <TintedWords runs={runs} focus={null} tags />}
                {unclear.length > 0 && (
                    <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-2 text-[14.5px] text-[#1C1917]" data-testid="vr2-unclear">
                        <b className="block text-[12.5px] font-bold text-[#92400E]">{RS.unclearTitle}</b>
                        {unclear.map((u, i) => <div key={i}>“{u}”</div>)}
                    </div>
                )}
            </div>
        );
    }
    return (
        <RbSec testId={testId} title={copy.yourWords}>
            {player && <div className="mb-2">{player}</div>}
            {wordsWithheld ? <MoneyWordsWithheldCard testId="vr-words-withheld" /> : runs.length > 0 && <TintedWords runs={runs} focus={focus} />}
            <WhyTiles runs={runs} entries={entries} focus={focus} onFocus={setFocus} />
            {unclear.length > 0 && (
                <div className="mt-2 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-2 text-[14.5px] text-[#1C1917]" data-testid="vr2-unclear">
                    <b className="block text-[12.5px] font-bold text-[#92400E]">{RS.unclearTitle}</b>
                    {unclear.map((u, i) => <div key={i}>“{u}”</div>)}
                </div>
            )}
        </RbSec>
    );
};

export default SavedWords;
