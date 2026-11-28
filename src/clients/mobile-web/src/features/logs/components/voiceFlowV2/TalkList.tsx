/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B3) — "आजची बोलणी", as the final design draws it (result-v12-final.html
 * `dayList()`): one row per talk of the day on this place, the talk he just made first, then the earlier ones newest first. Each row:
 * who spoke (the round initial and the name), the time, "आत्ताचं" on the talk he just made, one icon per part it told, and the length of
 * its voice. A tap opens the whole talk (`TalkView`).
 *
 * Only what is on this phone: the rows are the day's recordings the screen already reads (`DayView`), i.e. what sync has put here.
 * The length is the clip's own, shown only when its clip is on this phone (never a made-up length); a typed talk shows its tag instead.
 */
import React from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { toDevanagariDigits } from '../../../../shared/utils/marathiDigits';
import { mmss } from '../voiceResult/ClipPlayer';
import { PartIcon } from '../voiceResult/HisWords';
import { partNameIn } from '../voiceResult/partNames';
import { resultCopy } from '../voiceResult/resultCopy';
import { partMeta, type PartKey, type RecordingView } from '../voiceResult/resultModel';
import { CategoryIcon } from '../shramsathi/understandingRing/CategoryIcon';
import { finalResultWords } from './finalResultWords';
import { Bd, LineGlyph, SANS } from './savedBits';

/** U+094D, the Devanagari virama (written by code point: it is an invisible joiner in source). */
const VIRAMA = String.fromCharCode(0x094d);
/** A combining mark, or the zero-width non-joiner / joiner (U+200C, U+200D), by code point. */
const JOINERS = String.fromCharCode(0x200c, 0x200d);
const isMark = (ch: string): boolean => /\p{M}/u.test(ch) || JOINERS.includes(ch);

/** The first letter of a name as it is written ("रामू" → "रा", "क्षितिज" → "क्षि", "Ramesh" → "R"). */
export function initialOf(name: string): string {
    const chars = [...name.trim()];
    if (chars.length === 0) return '';
    let out = chars[0];
    for (let i = 1; i < chars.length; i += 1) {
        if (isMark(chars[i]) || out.endsWith(VIRAMA)) out += chars[i];
        else break;
    }
    return out;
}

export interface TalkRow {
    rec: RecordingView;
    /** The talk he just made. */
    now: boolean;
    /** The parts it told, products first (`talkDay.partsOfTalk`). */
    parts: readonly PartKey[];
    /** It reported a stoppage (अडथळा). */
    blocker: boolean;
    /** Its clip's length, only when its clip is on this phone. */
    lengthSec: number | null;
}

export interface TalkListProps {
    rows: readonly TalkRow[];
    /** "आजची बोलणी", or the day's own words for a recording saved for another day. */
    title: string;
    onOpen: (recId: string) => void;
}

export const TalkList: React.FC<TalkListProps> = ({ rows, title, onOpen }) => {
    const language = useOptionalLanguage()?.language;
    const FW = finalResultWords(language);
    const copy = resultCopy(language);
    if (rows.length === 0) return null;
    return (
        <section className="flex flex-col gap-2" data-testid="vr2-talks" style={{ fontFamily: SANS }}>
            <div className="text-[15px] font-extrabold leading-[1.3] text-[#292524]" data-testid="vr2-talks-title">
                {title}
                <small className="block text-[12.5px] font-semibold text-[#78716C]">{FW.talksHint}</small>
            </div>
            <div className="flex flex-col gap-2">
                {rows.map(({ rec, now, parts, blocker, lengthSec }) => (
                    <button key={rec.id} type="button" onClick={() => onOpen(rec.id)} data-testid={`vr2-talk-row-${rec.id}`} data-now={now ? 'yes' : 'no'}
                        className={`flex w-full items-center gap-2.5 rounded-[18px] border-[1.5px] p-2.5 text-left text-[#1C1917] active:scale-[0.99] ${now ? 'border-[#6EE7B7] bg-[#F7FEFA]' : 'border-[#E7E5E4] bg-white'}`}>
                        <span className="grid h-[46px] w-[46px] flex-none place-items-center rounded-full text-[19px] font-extrabold text-white"
                            style={{ background: rec.who.you ? '#0F6B3A' : '#1D4ED8' }} aria-hidden="true">{initialOf(rec.who.name)}</span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                            <span className="flex flex-wrap items-center gap-1.5">
                                <b className="text-[17px] font-extrabold leading-[1.2]" data-testid={`vr2-talk-who-${rec.id}`}>{rec.who.name}</b>
                                {rec.timeLabel && <span className="whitespace-nowrap rounded-full bg-[#065F46] px-2.5 py-px text-[12.5px] font-extrabold text-white" data-testid={`vr2-talk-time-${rec.id}`}>{rec.timeLabel}</span>}
                                {now && <span className="rounded-md bg-[#D1FAE5] px-1.5 text-[11.5px] font-extrabold text-[#065F46]" data-testid={`vr2-talk-now-${rec.id}`}>{FW.nowPill}</span>}
                                {rec.typed && <Bd tone="amber" testId={`vr2-talk-typed-${rec.id}`}>{copy.typedTag}</Bd>}
                            </span>
                            <span className="flex flex-wrap items-center gap-[5px]" data-testid={`vr2-talk-parts-${rec.id}`}>
                                {parts.map(p => (
                                    <i key={p} className="grid h-7 w-7 place-items-center rounded-lg not-italic" style={{ background: partMeta(p).tint }}
                                        title={partNameIn(p, language)} data-part={p}><PartIcon part={p} size={19} /></i>
                                ))}
                                {blocker && (
                                    <i className="grid h-7 w-7 place-items-center rounded-lg bg-[#FFE4D6] not-italic" data-part="blockers"><CategoryIcon name="blockers" size={19} /></i>
                                )}
                                {lengthSec != null && (
                                    <span className="ml-1 inline-flex items-center gap-[3px] text-[13px] font-extrabold text-[#57534E]" data-testid={`vr2-talk-length-${rec.id}`}>
                                        <LineGlyph name="speaker" size={15} />{language === 'en' ? mmss(lengthSec) : toDevanagariDigits(mmss(lengthSec))}
                                    </span>
                                )}
                            </span>
                        </span>
                        <LineGlyph name="go" size={22} className="flex-none text-[#78716C]" />
                    </button>
                ))}
            </div>
            <div className="px-2 py-0.5 text-center text-[12px] text-[#78716C]">{FW.talksFoot}</div>
        </section>
    );
};

export default TalkList;
