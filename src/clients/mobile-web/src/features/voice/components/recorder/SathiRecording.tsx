/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (F4) - the recording screen as the founder approved it (prototype shots 04, 05): Sathi in the
 * centre of the ring of the parts, his bubble "आता बोला - मी ऐकतोय", the status line, the calm field picture, the words strip, and at
 * the bottom the timer, the red stop and "झालं की थांबवा".
 *
 * Truth rules (doctrine): the words strip shows the words the speech service has heard so far (voice live words, 28 Nov 2026: a phrase
 * at a time, from the server, display only; until the first phrase arrives, or when none can, it keeps its calm "बोला... साथी ऐकतोय"),
 * and NO part lights while he speaks (P4: a part lights only from the server's real answer, which comes after stop, on the saved
 * screen: the ring never sorts live words). The final words are always the batch answer's own. The status line counts the
 * real seconds of audio held on the PHONE and says "फोनवर", never "सर्व्हरवर" (P10). The field picture is a still picture of his plot
 * with its name; nothing in it is drawn "from his voice".
 * Reduced motion: no pulse, no ring animation (P11). The stop is a 72 px target; the cancel keeps its place and its words.
 *
 * The bottom area (silence hints, timer, stop, cancel) is drawn into the voice layer's bottom slot, so the stop never moves and
 * never scrolls away; outside a layer it is drawn in the flow, as before.
 *
 * spec plr-d10 (part 03, A2; the founder's final design, 28 Nov): when he has gone quiet after speaking (`help.quietSince`), a red ring
 * fills round the red stop over the 3 s of quiet that end the recording by itself, the line beside the stop says "शांत आहे… आपोआप
 * थांबतोय" and Sathi's bubble asks "अजून काही?" / "नसेल तर साथी आपोआप थांबेल". The red stop stays, and one tap on it still stops.
 * The ring is drawn by a CSS animation started at the quiet's real start (no per-frame re-render); under reduced motion it is not
 * drawn and the words say it.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Square, X } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { CategoryIcon } from '../../../logs/components/shramsathi/understandingRing/CategoryIcon';
import { CATEGORY_META, type CategoryId } from '../../../logs/components/shramsathi/understandingRing/categories';
import { ringNodesV2 } from '../../../logs/components/voiceResult/resultModel';
import { useVoiceLayerBottom } from '../../../logs/components/voiceFlowV2/VoiceLayer';
import { voiceFlowWords } from '../../flowV2/voiceFlowWords';
import { HintSlot, type SilenceHelpView } from './SilenceHelp';
import { QUIET_STOP_MS } from './silenceHelpModel';
import { AUTO_STOP_SEC, AUTO_STOP_WARN_SEC, REC_WORDS, autoStoppingIn, formatClock } from './recorderWords';

const SANS = "'Noto Sans Devanagari', sans-serif";
const SERIF = "'Noto Serif Devanagari', serif";
const SATHI = '/images/sathi/sathi-points-down-both.png';
const ALL: readonly CategoryId[] = ['work', 'labour', 'inputs', 'water', 'machinery', 'expenses', 'observations', 'reminders'];
const BOX = 288;
const RADIUS = 104;
/** The quiet ring round the 72 px stop: 9 px outside it (the design's `.sring`), r 41, a 5 px stroke. */
const QUIET_R = 41;
const QUIET_C = 2 * Math.PI * QUIET_R;
const QUIET_CSS = `@keyframes vfQuietFill{from{stroke-dashoffset:${QUIET_C.toFixed(2)}}to{stroke-dashoffset:0}}`;

/** The design's `.sring`: a red ring that fills over the quiet; started where the quiet really began (`since`). */
const QuietRing: React.FC<{ since: number }> = ({ since }) => {
    const elapsed = Math.max(0, Math.min(QUIET_STOP_MS, Date.now() - since));
    return (
        <svg data-testid="mic-stop-quiet" aria-hidden="true" viewBox="0 0 90 90" className="pointer-events-none absolute -inset-[9px] h-[90px] w-[90px] motion-reduce:hidden">
            <style>{QUIET_CSS}</style>
            <circle cx="45" cy="45" r={QUIET_R} fill="none" stroke="rgba(229,72,77,.18)" strokeWidth="5" />
            <circle cx="45" cy="45" r={QUIET_R} fill="none" stroke="#E5484D" strokeWidth="5" strokeLinecap="round" strokeDasharray={QUIET_C} transform="rotate(-90 45 45)"
                style={{ strokeDashoffset: 0, animation: `vfQuietFill ${QUIET_STOP_MS}ms linear ${-elapsed}ms both` }} />
        </svg>
    );
};

/** The ring of the parts, in the app's own v2 order and names. While he speaks every part stays quiet (P4). */
const PartsRing: React.FC<{ labels: Readonly<Record<string, string>> }> = ({ labels }) => {
    const nodes = ringNodesV2(Object.fromEntries(ALL.map(id => [id, 'neutral' as const])));
    return (
        <div className="relative mx-auto shrink-0" style={{ width: BOX, height: BOX - 24, maxWidth: '100%' }} data-testid="sathi-ring" data-lit="0">
            {nodes.map((n, i) => {
                const a = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
                const x = BOX / 2 + RADIUS * Math.cos(a);
                const y = (BOX - 24) / 2 + RADIUS * Math.sin(a) * 0.92;
                return (
                    <span key={n.id} data-testid={`sathi-ring-${n.id}`} data-state="quiet" className="absolute flex w-[72px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
                        style={{ left: x, top: y }}>
                        <span className="grid h-[34px] w-[34px] place-items-center rounded-full border border-[#DDE3DA] bg-white"><CategoryIcon name={CATEGORY_META[n.id].icon} size={20} /></span>
                        <span className="line-clamp-2 w-full text-center text-[10.5px] font-extrabold leading-[1.15] text-[#5F6B63]" data-testid={`sathi-ring-label-${n.id}`}>{labels[n.id] ?? n.label.replace(/<br\s*\/?>/g, ' ')}</span>
                    </span>
                );
            })}
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ marginTop: -2 }}>
                <img src={SATHI} alt="" width={104} height={104} aria-hidden="true" className="h-[104px] w-[104px] rounded-full object-cover object-top"
                    style={{ background: '#FFF6C6', boxShadow: '0 0 0 3px rgba(30,158,90,.28)' }} />
            </span>
        </div>
    );
};

/** A calm still picture of his plot (rows in the soil), with its name. Drawn from nothing he said. */
const FieldPicture: React.FC<{ caption: string }> = ({ caption }) => (
    <div className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-2xl border border-[#DDE3DA]" style={{ height: 96, background: 'linear-gradient(180deg,#FFF6D8,#E9DDB5 60%,#D8C998)' }} data-testid="sathi-field">
        <svg viewBox="0 0 300 96" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6].map(i => <line key={i} x1={150 + (i - 3) * 6} y1={30} x2={150 + (i - 3) * 52} y2={96} stroke="#9C8A55" strokeWidth="1.2" opacity=".55" />)}
        </svg>
        <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2.5 py-0.5 text-[12px] font-extrabold text-[#1C1917]" style={{ fontFamily: SANS }}>{caption}</span>
    </div>
);

export interface SathiRecordingProps {
    seconds: number;
    level?: number;
    onStop: () => void;
    onCancel: () => void;
    help: SilenceHelpView;
    /** "द्राक्ष · प्लॉट १" - absent when the recorder does not know the place. */
    place?: string;
    /** The words heard so far in what he is saying (plain text, newest at the end). Empty/absent = the calm placeholder line. */
    liveWords?: string;
}

export const SathiRecording: React.FC<SathiRecordingProps> = ({ seconds, level, onStop, onCancel, help, place, liveWords }) => {
    const language = useOptionalLanguage()?.language;
    const W = voiceFlowWords(language);
    const slot = useVoiceLayerBottom();
    const quietSince = help.quietSince ?? null;
    const bubble = quietSince !== null ? { t: W.moreAsk, s: W.moreAskSub } : { t: W.sathiListening, s: W.sathiListeningSub };
    const heard = liveWords?.trim() ?? '';
    const body = (
        <div className="flex w-full flex-col gap-2.5 pb-2" style={{ fontFamily: SANS }} data-testid="mic-ui" data-recording="yes">
            <div className="relative mx-auto mt-1 max-w-full rounded-2xl border border-[#9ACBAD] bg-white px-4 py-2 text-center shadow-[0_2px_10px_rgba(20,60,40,0.07)]" data-testid="sathi-bubble">
                <p className="m-0 text-[16px] font-bold leading-[1.4] text-[#1C1917]" style={{ fontFamily: SERIF }} data-testid="mic-listening">{bubble.t}</p>
                <p className="m-0 text-[12.5px] font-semibold leading-[1.45] text-[#5F6B63]">{bubble.s}</p>
                <span aria-hidden="true" className="absolute -bottom-[7px] left-1/2 h-[14px] w-[14px] -translate-x-1/2 rotate-45 border-b border-r border-[#9ACBAD] bg-white" />
            </div>
            <PartsRing labels={W.ringLabels} />
            <FieldPicture caption={W.fieldCaption(place ?? '')} />
            <p className="m-0 text-center text-[13px] font-extrabold text-[#0F6B3A]" data-testid="sathi-status" aria-live="off">
                {seconds >= 1 ? W.recOnPhone(seconds) : ' '}
            </p>
            <p className={`m-0 max-h-[104px] overflow-hidden rounded-2xl border border-[#DDE3DA] bg-white px-3.5 py-2.5 text-[15px] font-semibold leading-[1.45] [overflow-wrap:anywhere] ${heard ? 'text-[#1C1917]' : 'text-[#5F6B63]'}`}
                data-testid="sathi-words-strip" data-live={heard ? 'yes' : 'no'} aria-live="off">{heard || W.wordsStrip}</p>
        </div>
    );
    const bottom = (
        <div className="flex w-full flex-col items-center gap-1 border-t border-[#DDE3DA] bg-white px-3.5 pt-1" data-testid="sathi-recording-bottom"
            style={{ fontFamily: SANS, paddingBottom: 'calc(0.75rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))' }}>
            <HintSlot stage={help.stage} listening={help.listening} />
            <div className="flex w-full items-center justify-between gap-3">
                <span className="flex min-w-[84px] items-center gap-1.5 font-mono text-[18px] font-bold tabular-nums text-[#1C1917]" data-testid="mic-clock">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500 motion-safe:animate-pulse" data-testid="mic-red-dot" aria-hidden="true" />{formatClock(seconds)}
                </span>
                <button type="button" onClick={onStop} data-testid="mic-stop" aria-label={REC_WORDS.tapToStop}
                    className="relative grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-[0_8px_22px_rgba(244,63,94,0.45)] outline-none active:scale-95 focus-visible:ring-4 focus-visible:ring-red-200"
                    style={level != null ? { boxShadow: `0 0 0 ${Math.round(2 + level * 12)}px rgba(244,63,94,${(0.12 + level * 0.25).toFixed(2)}), 0 8px 22px rgba(244,63,94,0.45)` } : undefined}>
                    {help.stage === 'doneAsk' && <span aria-hidden="true" data-testid="mic-stop-attention" className="absolute inset-0 rounded-full bg-red-400/50 motion-safe:animate-ping" style={{ animationDuration: '1.4s' }} />}
                    {quietSince !== null && <QuietRing key={quietSince} since={quietSince} />}
                    <Square size={30} fill="currentColor" className="relative" />
                </button>
                <span className="min-w-[84px] text-right text-[13px] font-extrabold leading-tight text-[#5F6B63]" data-testid="mic-stop-instruction" data-quiet={quietSince !== null ? 'yes' : 'no'}>
                    {quietSince !== null ? W.quietStopping : W.stopLabel}
                </span>
            </div>
            {seconds >= AUTO_STOP_WARN_SEC && (
                <p className="m-0 text-[14px] font-bold text-amber-700" data-testid="mic-auto-stop">{autoStoppingIn(Math.max(0, AUTO_STOP_SEC - seconds), language)}</p>
            )}
            <button type="button" onClick={onCancel} data-testid="mic-cancel"
                className="mt-1 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-rose-300 bg-white px-4 text-[14px] font-extrabold text-rose-700 active:scale-95">
                <X size={16} strokeWidth={3} aria-hidden="true" /> <span>{W.cancelLabel || REC_WORDS.cancel}</span>
            </button>
        </div>
    );
    return (
        <>
            {body}
            {slot === undefined ? bottom : slot ? createPortal(bottom, slot) : null}
        </>
    );
};

export default SathiRecording;
