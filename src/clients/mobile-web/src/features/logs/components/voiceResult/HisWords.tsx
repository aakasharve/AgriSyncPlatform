/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-11) — his words, marked.
 *
 * Founder 2026-10-24/25 (PLR-D1 round 2; preview TranscriptLinks): each phrase that made Sathi understand a
 * part is coloured in that part's tint and tagged with its icon; tapping a part's tile shows WHICH words did
 * it (and dims the rest). Only verified phrases are ever marked (`markTranscript`). The preview's "why" line
 * (reasons.ts) was a keyword stand-in and is NOT shipped: lane L6b's reason line only says which of his words led
 * to the item, in one fixed template — nothing invented.
 */
import React, { useState } from 'react';
import { ChevronDown, Lightbulb } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { CategoryIcon } from '../shramsathi/understandingRing';
import { resultCopy, type ResultCopy } from './resultCopy';
import { partMeta, phrasesByPart, type PartEntry, type PartKey, type WordRun } from './resultModel';
import { partNameIn } from './partNames';
import { amountText, productName } from './productModel';

const SERIF = "'Noto Serif Devanagari', serif";

export const PartIcon: React.FC<{ part: PartKey; size?: number }> = ({ part, size = 20 }) => (
    <CategoryIcon name={partMeta(part).icon} size={size} />
);

/** Every part a run of his words stands for: its own, then the others that share the same words (lane RWF). */
const partsOfRun = (r: WordRun | undefined): PartKey[] => (r?.part ? [r.part, ...(r.also ?? [])] : []);

/**
 * His words; a verified phrase carries its part's tint (and icon when `tags`); `focus` keeps one part bright. Words that made Sathi
 * understand more than one part show the first part's tint with a thin bar in the next part's, and every part gets its icon after its
 * last word (lane RWF: each part is flagged).
 */
export const Words: React.FC<{ runs: readonly WordRun[]; tags?: boolean; focus?: PartKey | null; size?: string; testId?: string }> = ({
    runs, tags = false, focus = null, size = 'text-[18px]', testId = 'vr-words',
}) => (
    <p className={`my-1 mb-2 ${size} leading-[1.75] text-stone-800`} style={{ fontFamily: SERIF }} data-testid={testId}>
        {runs.map((r, i) => {
            const parts = partsOfRun(r);
            if (!r.part) return <React.Fragment key={i}>{r.text}</React.Fragment>;
            const m = partMeta(r.part);
            const dim = focus != null && !parts.includes(focus);
            const second = r.also?.[0] ? partMeta(r.also[0]) : null;
            const next = partsOfRun(runs[i + 1]);
            const tagParts = tags ? parts.filter(p => !next.includes(p)) : [];
            return (
                <React.Fragment key={i}>
                    <mark data-part={r.part} data-parts={parts.join(' ')} data-dim={dim ? 'yes' : 'no'} className={`rounded px-0.5 text-inherit transition-opacity ${dim ? 'opacity-30' : ''} ${focus != null && parts.includes(focus) ? 'outline outline-2 outline-stone-700' : ''}`}
                        style={{ background: m.tint, ...(second ? { boxShadow: `inset 0 -5px 0 ${second.tint}, 0 1px 0 rgba(0,0,0,0.18)` } : {}) }}>{r.text}</mark>
                    {tagParts.map(p => (
                        <span key={p} aria-hidden="true" data-testid="vr-word-tag" data-part={p} className={`mx-0.5 inline-grid h-[26px] w-[26px] place-items-center rounded-full align-middle ${dim ? 'opacity-30' : ''}`}
                            style={{ background: partMeta(p).tint }}><PartIcon part={p} size={18} /></span>
                    ))}
                </React.Fragment>
            );
        })}
    </p>
);

/**
 * How Sathi understood an item, in the words of the screen (lane RWF: "how Shram Safal understood the input too"): for sprays and
 * fertilisers the method, the product and the amount he said ("फवारणी · Karate २५० मिली"); for every other part what was noted.
 */
export function wroteOf(entry: PartEntry, language: string | undefined, copy: ResultCopy): string {
    if (entry.part === 'inputs' && entry.products) {
        const kind = entry.products.kind === 'spray' ? copy.spray : entry.products.kind === 'drip' ? copy.drip : '';
        const what = entry.products.items
            .map(i => [productName(i, language), amountText(i.amount, language, true)].filter(Boolean).join(' '))
            .filter(Boolean).join(' + ');
        const text = [kind, what].filter(Boolean).join(' · ');
        if (text) return text;
    }
    return entry.value ?? '';
}

/** More phrases than this in one part fold behind "आणखी N दाखवा", so a long recording never makes a long page (design). */
export const SHOWN_PHRASES = 2;

/**
 * "श्रम साथीला हे का समजले?" (design TranscriptLinks.tsx, founder 2026-10-25): one tile per part his words were
 * marked with; the FIRST is open from the start; tapping a tile opens it and dims every other phrase in his words.
 * The open card shows his deciding phrase — the AI's own `sourceText` for that item, verified in his words —
 * highlighted, the one fixed reason line (which of his words led to it, never a made-up explanation: the preview's
 * keyword stand-in `reasons.ts` is not shipped), and what Sathi noted for it.
 */
export const PartLinks: React.FC<{ runs: readonly WordRun[]; entries: readonly PartEntry[]; focus: PartKey | null; onFocus: (p: PartKey | null) => void }> = ({
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
    // One card item per ENTRY of this part (not per colour run): his deciding words whole - a phrase with a gap as "A … B" - and how Sathi understood them.
    const said = runs.map(r => r.text).join('');
    const firstAt = (e: PartEntry): number => said.indexOf((e.quoteParts ?? [e.quote ?? ''])[0]);
    const items = entries.filter(e => e.part === shown.part && !!e.quote).sort((a, b) => firstAt(a) - firstAt(b));
    const phrases = expanded ? items : items.slice(0, SHOWN_PHRASES);
    const pick = (p: PartKey) => {
        setOpen(p);
        onFocus(focus === p && shown.part === p ? null : p);
    };
    return (
        <div className="mt-2" data-testid="vr-links">
            <div className="text-[16px] font-extrabold text-emerald-900" data-testid="vr-why-heading">{copy.whyHeading}</div>
            <p className="m-0 text-[13px] font-bold text-stone-600">{copy.whySub}</p>
            <p className="m-0 mb-2 text-[12px] font-semibold text-stone-500" data-testid="vr-plain-note">{copy.plainWordsNote}</p>
            <div className="grid grid-cols-4 gap-1.5">
                {groups.map(g => {
                    const m = partMeta(g.part);
                    const sel = shown.part === g.part;
                    return (
                        <button key={g.part} type="button" aria-pressed={sel} data-testid={`vr-link-${g.part}`} onClick={() => pick(g.part)}
                            className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border-2 px-1 py-1.5 text-center active:scale-95 ${sel ? 'border-stone-800 shadow-md' : 'border-transparent'}`}
                            style={{ background: m.tint }}>
                            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/80"><PartIcon part={g.part} size={26} /></span>
                            <span className="text-[12.5px] font-extrabold leading-tight text-stone-900">{partNameIn(g.part, language)}</span>
                        </button>
                    );
                })}
            </div>
            <div className="mt-2 space-y-3 rounded-3xl border-2 bg-white p-3 shadow-[0_6px_18px_rgba(23,50,31,0.08)]" style={{ borderColor: tint }} data-testid="vr-link-card" data-part={shown.part}>
                {phrases.map((entry, i) => {
                    const phrase = entry.quote ?? '';
                    const wrote = wroteOf(entry, language, copy);
                    return (
                        <div key={i} data-testid={`vr-link-phrase-${shown.part}-${i}`}>
                            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-[17px] font-semibold leading-snug text-stone-800">
                                <span aria-hidden="true" className="mr-1 text-[20px] font-black leading-none text-stone-400">“</span>
                                <mark data-testid={`vr-why-cue-${shown.part}-${i}`} className="rounded-md px-1 font-extrabold text-stone-900"
                                    style={{ background: tint, boxShadow: 'inset 0 -4px 0 rgba(0,0,0,0.12)' }}>{phrase}</mark>
                                <span aria-hidden="true" className="ml-1 text-[20px] font-black leading-none text-stone-400">”</span>
                            </div>
                            <div className="mt-1.5 flex items-start gap-2" data-testid={`vr-why-reason-${shown.part}-${i}`}>
                                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700"><Lightbulb size={14} aria-hidden="true" /></span>
                                <span className="min-w-0 text-[14.5px] font-bold leading-snug text-stone-700">{copy.whyReason}</span>
                            </div>
                            {wrote && wrote !== phrase && (
                                <div className="mt-1.5 flex items-center justify-between gap-2 rounded-xl px-3 py-1.5" style={{ background: tint }} data-testid={`vr-why-wrote-${shown.part}-${i}`}>
                                    <span className="text-[12.5px] font-extrabold text-stone-700">{copy.wrote}</span>
                                    <span className="text-[17px] font-extrabold leading-tight text-stone-900">{wrote}</span>
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

/**
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 1; DFES-simple-day-preview.html) - his words folded under ONE
 * line, "तुमचं बोलणं · शब्द पाहण्यासाठी दाबा", with his recording's play button beside it (or the typed note where there is none).
 * The words, the "why" tiles and the lines Sathi could not place open only when he taps the line.
 */
export const WordsFold: React.FC<{ open: boolean; onToggle: () => void; player?: React.ReactNode; children: React.ReactNode }> = ({ open, onToggle, player, children }) => {
    const copy = resultCopy(useOptionalLanguage()?.language);
    return (
        <div className="mt-2 rounded-2xl bg-white ring-1 ring-stone-200" data-testid="vr-words-fold" data-open={open ? 'yes' : 'no'}>
            <button type="button" onClick={onToggle} aria-expanded={open} data-testid="vr-words-toggle"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
                <span>
                    <span className="block text-[14.5px] font-extrabold text-stone-900">{copy.yourWords}</span>
                    <span className="block text-[12px] font-bold text-stone-500" data-testid="vr-words-hint">{open ? copy.hideWords : copy.seeWords}</span>
                </span>
                <ChevronDown size={20} className={`shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {open && <div className="border-t border-stone-100 px-3 pb-2.5 pt-1.5" data-testid="vr-words-body">{children}</div>}
            {player && <div className={`p-2 ${open ? 'border-t border-stone-100' : ''}`}>{player}</div>}
        </div>
    );
};
