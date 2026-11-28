/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A4; founder 28 Nov: "No old approved your new suggestion") — the log tab's
 * screen after he stops, in place of the step list:
 *   1. "जतन झालं ✓" pops once his recording is really kept on this phone (the save path's own 'kept' event, `voiceJourneySignal`), with
 *      one success buzz and the short soft sound (`softChime`), then steps aside by itself;
 *   2. Sathi's ring (`SathiRing`, chase) with "श्रम साथी समजून घेत आहे": a quiet light steps round the 9 icons while his words are being
 *      understood.
 * It stays exactly as long as the app is waiting for the real answer: it has NO timer that ends it (the founder: "brain screen should
 * remain unless and until the auto bucketing part is being done"). The router replaces it when the answer comes (the result screen then
 * lights the parts he told, `RingReveal`), or when the existing failure / offline paths take over. It never lights a part by itself.
 *
 * The pop's sub-line in the final design ("छान! आजचं काम जतन झालं") is left out: at this moment only his voice is kept; the work is not yet
 * understood or written (P10). A journey that began before this screen (an earlier recording) is ignored.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { readVoiceJourney, subscribeVoiceJourney } from '../../../../infrastructure/voice/voiceJourneySignal';
import { logger } from '../../../../infrastructure/observability/Logger';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { hapticFeedback } from '../../../../shared/utils/haptics';
import { playSoftChime } from '../../../../shared/utils/softChime';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { liveJourney } from './journeyModel';
import { SathiRing } from './SathiRing';

const SANS = "'Noto Sans Devanagari', sans-serif";
const SERIF = "'Noto Serif Devanagari', serif";
/** How long "जतन झालं ✓" stays before it steps aside (the design: about two seconds). */
export const SAVED_POP_MS = 1800;

const POP_CSS = '@keyframes rwPop{0%{transform:scale(.7);opacity:0}100%{transform:none;opacity:1}}'
    + '@keyframes rwFade{0%{opacity:0}100%{opacity:1}}'
    + '@keyframes rwDraw{to{stroke-dashoffset:0}}'
    + '@keyframes rwDot{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-2px)}}';

/** A line led by the app's name in brand green. */
export const BrandLine: React.FC<{ brand: string; rest: string; testId: string }> = ({ brand, rest, testId }) => (
    <p className="m-0 w-full whitespace-nowrap text-center font-semibold leading-[1.4] tracking-[.1px] text-[#292524]" style={{ fontSize: 'clamp(15px, 5.4vw, 20px)', fontFamily: SANS }}
        data-testid={testId}>
        <span className="text-[#0F6B3A]">{brand}</span> {rest}
    </p>
);

/** The design's `.svov` / `.svcard`: a green tick and "जतन झालं ✓" over the screen. */
const SavedPop: React.FC<{ title: string; onDone: () => void }> = ({ title, onDone }) => (
    <div className="fixed inset-0 z-[55] grid place-items-center bg-[rgba(250,250,247,0.86)] motion-safe:[animation:rwFade_.25s_ease_both]"
        data-testid="saved-pop" role="status" onClick={onDone} style={{ fontFamily: SANS }}>
        <div className="flex w-[268px] max-w-[86vw] flex-col items-center gap-1.5 rounded-[26px] border-2 border-[#9FD9B5] bg-white px-4 pb-4 pt-5 text-center shadow-[0_16px_40px_rgba(15,107,58,0.22)] motion-safe:[animation:rwPop_.5s_cubic-bezier(.3,1.6,.5,1)_both]">
            <span className="grid h-[76px] w-[76px] place-items-center rounded-full bg-[#1E9E5A] shadow-[0_0_0_8px_#E3F5EA]" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="42" height="42">
                    <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"
                        strokeDasharray="24" className="motion-safe:[stroke-dashoffset:24] motion-safe:[animation:rwDraw_.45s_.25s_ease_forwards]" />
                </svg>
            </span>
            <b className="mt-1.5 text-[30px] font-bold leading-[1.2] text-[#0F6B3A]" style={{ fontFamily: SERIF }} data-testid="saved-pop-title">{title}</b>
        </div>
    </div>
);

export const RingWaitScreen: React.FC = () => {
    const W = voiceFlowWords(useOptionalLanguage()?.language);
    const [mountedAt] = useState(() => Date.now());
    const snapshot = useSyncExternalStore(subscribeVoiceJourney, readVoiceJourney, readVoiceJourney);
    const journey = liveJourney(snapshot, mountedAt);
    const kept = journey?.keptAt !== undefined;
    const [pop, setPop] = useState(false);
    const popped = useRef(false);

    useEffect(() => { logger.info('voice_v2.ring.shown'); }, []);
    // The recording is really kept on this phone: the pop, one success buzz, the soft sound — once.
    useEffect(() => {
        if (!kept || popped.current) return;
        popped.current = true;
        setPop(true);
        hapticFeedback.success();
        playSoftChime();
        logger.info('voice_v2.ring.saved_pop');
    }, [kept]);
    // The pop steps aside by itself (a tap also closes it); the ring stays.
    useEffect(() => {
        if (!pop) return undefined;
        const id = window.setTimeout(() => setPop(false), SAVED_POP_MS);
        return () => window.clearTimeout(id);
    }, [pop]);

    return (
        <section className="mx-auto flex w-full max-w-md flex-col items-center gap-6 pt-3" style={{ fontFamily: SANS }}
            data-testid="ring-wait" data-understood={journey?.understoodAt !== undefined ? 'yes' : 'no'} aria-busy="true">
            <style>{POP_CSS}</style>
            <BrandLine brand={W.brand} rest={W.understandingRest} testId="ring-wait-line" />
            <SathiRing mode="chase" />
            <span className="inline-flex gap-1" aria-hidden="true" data-testid="ring-wait-dots">
                {[0, 1, 2].map(i => (
                    <i key={i} className="h-1.5 w-1.5 rounded-full bg-[#1E9E5A] motion-safe:[animation:rwDot_1.2s_ease-in-out_infinite]" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
            </span>
            <p className="sr-only" role="status">{`${W.brand} ${W.understandingRest}`}</p>
            {pop && <SavedPop title={`${W.savedTitle} ✓`} onDone={() => setPop(false)} />}
        </section>
    );
};

export default RingWaitScreen;
