/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-11) — his words, marked.
 *
 * Founder 2026-10-24/25 (PLR-D1 round 2; preview TranscriptLinks): each phrase that made Sathi understand a
 * part is coloured in that part's tint and tagged with its icon; tapping a part's tile shows WHICH words did
 * it (and dims the rest). Only verified phrases are ever marked (`markTranscript`). The preview's "why" line
 * (reasons.ts) was a stand-in and is left out: the real deciding word must come from the server, so here
 * the tile shows his phrase and what Sathi noted — nothing invented.
 */
import React, { useState } from 'react';
import { CategoryIcon } from '../shramsathi/understandingRing';
import { partMeta, phrasesByPart, type PartEntry, type PartKey, type WordRun } from './resultModel';
import { RESULT_STR } from './resultStrings';

const SERIF = "'Noto Serif Devanagari', serif";

export const PartIcon: React.FC<{ part: PartKey; size?: number }> = ({ part, size = 20 }) => (
    <CategoryIcon name={partMeta(part).icon} size={size} />
);

/** His words; a verified phrase carries its part's tint (and icon when `tags`); `focus` keeps one part bright. */
export const Words: React.FC<{ runs: readonly WordRun[]; tags?: boolean; focus?: PartKey | null; size?: string; testId?: string }> = ({
    runs, tags = false, focus = null, size = 'text-[18px]', testId = 'vr-words',
}) => (
    <p className={`my-1 mb-2 ${size} leading-[1.75] text-stone-800`} style={{ fontFamily: SERIF }} data-testid={testId}>
        {runs.map((r, i) => {
            if (!r.part) return <React.Fragment key={i}>{r.text}</React.Fragment>;
            const m = partMeta(r.part);
            const dim = focus != null && focus !== r.part;
            return (
                <React.Fragment key={i}>
                    <mark data-part={r.part} data-dim={dim ? 'yes' : 'no'} className={`rounded px-0.5 text-inherit transition-opacity ${dim ? 'opacity-30' : ''} ${focus === r.part ? 'outline outline-2 outline-stone-700' : ''}`}
                        style={{ background: m.tint }}>{r.text}</mark>
                    {tags && (
                        <span aria-hidden="true" data-testid="vr-word-tag" className={`mx-0.5 inline-grid h-[26px] w-[26px] place-items-center rounded-full align-middle ${dim ? 'opacity-30' : ''}`}
                            style={{ background: m.tint }}><PartIcon part={r.part} size={18} /></span>
                    )}
                </React.Fragment>
            );
        })}
    </p>
);

/** One tile per marked part; the open tile shows his phrase(s) and what Sathi noted for it. */
export const PartLinks: React.FC<{ runs: readonly WordRun[]; entries: readonly PartEntry[]; focus: PartKey | null; onFocus: (p: PartKey | null) => void }> = ({
    runs, entries, focus, onFocus,
}) => {
    const groups = phrasesByPart(runs);
    const [open, setOpen] = useState<PartKey | null>(null);
    if (groups.length === 0) return null;
    const shown = groups.find(g => g.part === (open ?? focus)) ?? null;
    const pick = (p: PartKey) => {
        const closing = shown?.part === p;
        setOpen(closing ? null : p);
        onFocus(closing ? null : p);
    };
    return (
        <div className="mt-1" data-testid="vr-links">
            <p className="m-0 mb-2 text-[13px] font-bold text-stone-600">{RESULT_STR.linksSub}</p>
            <div className="grid grid-cols-4 gap-1.5">
                {groups.map(g => {
                    const m = partMeta(g.part);
                    const sel = shown?.part === g.part;
                    return (
                        <button key={g.part} type="button" aria-pressed={sel} data-testid={`vr-link-${g.part}`} onClick={() => pick(g.part)}
                            className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border-2 px-1 py-1.5 text-center active:scale-95 ${sel ? 'border-stone-800 shadow-md' : 'border-transparent'}`}
                            style={{ background: m.tint }}>
                            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/80"><PartIcon part={g.part} size={26} /></span>
                            <span className="text-[12.5px] font-extrabold leading-tight text-stone-900">{m.label}</span>
                        </button>
                    );
                })}
            </div>
            {shown && (
                <div className="mt-2 space-y-2 rounded-3xl border-2 bg-white p-3" style={{ borderColor: partMeta(shown.part).tint }} data-testid="vr-link-card" data-part={shown.part}>
                    {shown.phrases.map((phrase, i) => {
                        const noted = entries.find(e => e.part === shown.part && e.quote === phrase);
                        return (
                            <div key={i} data-testid={`vr-link-phrase-${shown.part}-${i}`}>
                                <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-[17px] font-semibold leading-snug text-stone-800">“{phrase}”</div>
                                {noted?.value && noted.value !== phrase && (
                                    <div className="mt-1.5 flex items-center justify-between gap-2 rounded-xl px-3 py-1.5" style={{ background: partMeta(shown.part).tint }}>
                                        <span className="text-[12.5px] font-extrabold text-stone-700">{RESULT_STR.wrote}</span>
                                        <span className="text-[17px] font-extrabold leading-tight text-stone-900">{noted.value}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
