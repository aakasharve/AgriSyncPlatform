/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, LP-04, LP-06) — what BOTH real recorders
 * (`AudioRecorder`, `AudioRecorderStreaming`) show. Ported from the founder-approved preview
 * `postVoiceResult/MicRecorderUI.tsx` + `TypedLog.tsx`; it owns NO audio:
 *   IDLE      one calm card: the legacy green mic and, beside it, the founder's own sentence;
 *             under it the quiet "type instead" line (the real typed entry);
 *   RECORDING the legacy look plus: a red dot + "ऐकत आहे", the clock, a LIVE level meter around the
 *             big red stop, the stop instruction right under it, after 10 s a hint about when to
 *             press stop, and — set well apart — a clearly drawn cancel with the founder's words.
 *
 * Cancel still DISCARDS the clip (the recorder empties it). Keeping it as a silent draft waits on
 * the open consent decision (PLR-D5 :43, :57, :67) and is deliberately not built here.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Mic, X } from 'lucide-react';
import { hapticFeedback } from '../../../../shared/utils/haptics';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { VoiceLevelRing } from './VoiceLevelRing';
import { TypedLink, TypedSheet, TypedTag } from './TypedEntry';
import type { RecorderFlowV2 } from './flowV2Types';
import { MicCard } from './MicCard';
import { SathiRecording } from './SathiRecording';
import { NothingUnderstood } from './NothingUnderstood';
import { HintSlot, useSilenceHelp, type AutoCancelReason } from './SilenceHelp';
import { AUTO_START_SEC, noteLevelUnmeasurable, noteMicGranted, useAutoStartCountdown } from './useAutoStartCountdown';
import { logger } from '../../../../infrastructure/observability/Logger';
import {
    AUTO_STOP_SEC, AUTO_STOP_WARN_SEC, MIC_INSTRUCTION, REC_WORDS, autoStoppingIn, STOP_HINT_AFTER_SEC, STOP_HINT_FOR_SEC, formatClock,
} from './recorderWords';

const SANS = "'Noto Sans Devanagari', sans-serif";
/** How long "बोलणं रद्द केलं" stays on the card after cancel. */
export const CANCELLED_NOTE_MS = 1600;
/** spec voice-flow-v2-2026-11-23 (M1) — a start that never answers frees the mic button again after this. */
const START_GUARD_MS = 5000;
/** How long the stamp stays on Sathi after stop. */
const STAMP_MS = 1400;

export interface RecorderFaceProps {
    isRecording: boolean;
    /** Seconds on the clock while recording. */
    seconds: number;
    /** Live input level 0..1 from the real stream; undefined = not measurable (no meter is drawn). */
    level?: number;
    /** No crop/plot chosen yet: the card says so and a tap asks for the choice instead. */
    disabled?: boolean;
    /** Pulse the idle mic to invite the first tap. */
    suggest?: boolean;
    /** What went wrong, already in words he can read. */
    error?: string | null;
    /** P4 (voice-instant-phase-a): his words were KEPT after a server failure: a calm line, never the red error box. */
    keptNote?: string | null;
    /** The technical cause of a mic failure (e.g. NotReadableError): never shown, kept on the box for diagnosis. */
    errorCode?: string | null;
    /** The words behind the error (what was heard, or what he typed). */
    transcript?: string;
    /** The last thing sent was TYPED: its words are tagged "लिहिलेलं", never quoted as heard. */
    lastInputTyped?: boolean;
    /** The phone refused the microphone: typing becomes the main way in. */
    micRefused?: boolean;
    onStart: () => void;
    onStop: () => void;
    onCancel: () => void;
    onRequestContextSelection?: () => void;
    /** The real typed entry (same parse as speaking). Absent = no typing way in. */
    onTextCaptured?: (text: string) => void;
    /** spec voice-flow-v2-2026-11-23 — the v2 mic card and silence help. Absent = today's recorder, unchanged. */
    flowV2?: RecorderFlowV2;
}

interface RecordingProps {
    seconds: number;
    level?: number;
    onStop: () => void;
    onCancel: () => void;
    /** spec voice-flow-v2-2026-11-23 — the silence help in ONE fixed slot above the stop (replaces the 10 s hint). */
    silenceHelp?: boolean;
    /** This recording was started by the mic card's ring, not by his tap. */
    autoStarted?: boolean;
    onAutoCancel?: (reason: AutoCancelReason) => void;
    /** F4: "द्राक्ष · प्लॉट १", for the field picture of the v2 recording screen. */
    place?: string;
}

const Recording: React.FC<RecordingProps> = ({ seconds, level, onStop, onCancel, silenceHelp = false, autoStarted = false, onAutoCancel, place }) => {
    const [hintDismissed, setHintDismissed] = useState(false);
    const language = useOptionalLanguage()?.language;
    const help = useSilenceHelp({ on: silenceHelp || autoStarted, level, autoStarted, onAutoCancel });
    const hintOn = !silenceHelp && !hintDismissed && seconds >= STOP_HINT_AFTER_SEC && seconds < STOP_HINT_AFTER_SEC + STOP_HINT_FOR_SEC;
    // spec voice-flow-v2-2026-11-23 (F4): with the flow on, the recording screen is Sathi's (ring of the parts, bubble, field, bottom stop).
    if (silenceHelp) return <SathiRecording seconds={seconds} level={level} onStop={onStop} onCancel={onCancel} help={help} place={place} />;
    return (
        <div data-testid="mic-ui" data-recording="yes" style={{ fontFamily: SANS }}
            className="relative flex w-full flex-col items-center overflow-hidden rounded-[28px] border border-emerald-200 bg-[#FCFCFC] px-3 pb-3 pt-3 text-stone-800 shadow-[0_8px_30px_rgba(16,185,129,0.12)]">
            {/* the understanding screen's green and blue glints, calm and still under reduced motion */}
            <span aria-hidden="true" className="pointer-events-none absolute -left-10 -top-10 h-56 w-56 motion-safe:animate-plr-glint rounded-full bg-[radial-gradient(circle,rgba(22,178,78,0.30),transparent_67%)]" />
            <span aria-hidden="true" className="pointer-events-none absolute -right-12 top-24 h-56 w-56 motion-safe:animate-plr-glint rounded-full bg-[radial-gradient(circle,rgba(28,108,240,0.26),transparent_65%)]" style={{ animationDelay: '0.7s' }} />

            {/* One row: red dot + "ऐकत आहे" + the clock — every element of the approved look, one line high. */}
            <div className="relative flex w-full items-center justify-center gap-3">
                <span className="h-3.5 w-3.5 shrink-0 motion-safe:animate-pulse rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)]" data-testid="mic-red-dot" />
                <h3 className="m-0 text-2xl font-bold text-stone-800" data-testid="mic-listening">{REC_WORDS.listening}</h3>
                <p className="m-0 font-mono text-3xl font-medium tabular-nums tracking-wider text-emerald-800" data-testid="mic-clock">{formatClock(seconds)}</p>
            </div>

            {silenceHelp && <HintSlot stage={help.stage} listening={help.listening} />}
            <VoiceLevelRing level={level} onStop={onStop} label={REC_WORDS.tapToStop} attention={silenceHelp ? help.stage === 'doneAsk' : hintOn} />
            <p className="relative m-0 text-[18px] font-extrabold text-stone-700" data-testid="mic-stop-instruction">{REC_WORDS.tapToStop}</p>
            {/* After 10 seconds of speaking: when to press the red button, and why to keep going until then.
                spec: plr-d10 (lane L6b fix) — it sits UNDER the stop, in the flow, never over it: drawn as an overlay
                at the top of the card it covered the red button, so his first tap landed on the note and the
                recording went on (founder's live test, 2026-10-30). One tap on stop always stops. */}
            {hintOn && (
                <div role="note" data-testid="mic-stop-hint"
                    className="pointer-events-none relative mt-2 w-full motion-safe:animate-plr-pop rounded-2xl border-2 border-red-300 bg-white p-3 shadow-[0_10px_30px_rgba(244,63,94,0.25)]">
                    <p className="m-0 text-[16px] font-extrabold leading-snug text-stone-900">{REC_WORDS.stopHint}</p>
                    <button type="button" onClick={() => setHintDismissed(true)} data-testid="mic-stop-hint-ok"
                        className="pointer-events-auto mt-2 inline-flex min-h-[48px] items-center rounded-full bg-emerald-700 px-5 text-[16px] font-extrabold text-white active:scale-95">{REC_WORDS.gotIt}</button>
                </div>
            )}
            {seconds >= AUTO_STOP_WARN_SEC && (
                <p className="relative m-0 mt-1 text-[16px] font-bold text-amber-700" data-testid="mic-auto-stop">{autoStoppingIn(Math.max(0, AUTO_STOP_SEC - seconds), language)}</p>
            )}

            {/* Set apart from stop on purpose, drawn as a real button, in the founder's words. */}
            <button type="button" onClick={onCancel} data-testid="mic-cancel"
                className="relative mt-3 inline-flex min-h-[56px] max-w-[320px] items-center justify-center gap-2 rounded-3xl border-2 border-rose-300 bg-white px-5 py-2 text-center text-[16px] font-extrabold leading-snug text-rose-700 shadow-sm active:scale-95">
                <X size={20} strokeWidth={3} className="shrink-0" aria-hidden="true" /> <span className="[text-wrap:balance]">{REC_WORDS.cancel}</span>
            </button>
        </div>
    );
};

export const RecorderFace: React.FC<RecorderFaceProps> = ({
    isRecording, seconds, level, disabled, suggest, error, keptNote, errorCode, transcript, lastInputTyped, micRefused,
    onStart, onStop, onCancel, onRequestContextSelection, onTextCaptured, flowV2,
}) => {
    const language = useOptionalLanguage()?.language;
    const [typedOpen, setTypedOpen] = useState(false);
    const [justCancelled, setJustCancelled] = useState(false);
    const cancelTimer = useRef<number | null>(null);
    useEffect(() => () => { if (cancelTimer.current) window.clearTimeout(cancelTimer.current); }, []);

    // spec voice-flow-v2-2026-11-23 — the mic card's ring. It lives HERE, above the recording branch, so the plot tap it
    // answered stays used up after the card unmounts: a cancel, a mic error or any recording holds it until the NEXT
    // plot tap (B1). Without `flowV2.card` it never arms (armSeq 0) and nothing below changes today's face.
    const card = flowV2?.card;
    const v2On = flowV2 !== undefined;
    const [autoStarted, setAutoStarted] = useState(false);
    const [heldNote, setHeldNote] = useState(false);
    // F4: right after stop, Sathi shows the "लक्षात ठेवलं" stamp for a moment (the waiting list replaces it as soon as the save starts).
    const [stamped, setStamped] = useState(false);
    const stampTimer = useRef<number | null>(null);
    useEffect(() => () => { if (stampTimer.current) window.clearTimeout(stampTimer.current); }, []);
    useEffect(() => { if (isRecording) setStamped(false); }, [isRecording]);
    // M1 — one start at a time: a tap at 6.9 s and the 7 s timer can never open two recorders.
    const startingRef = useRef(false);
    const startGuardTimer = useRef<number | null>(null);
    const startOnce = (auto: boolean) => {
        if (startingRef.current) return;
        startingRef.current = true;
        if (startGuardTimer.current) window.clearTimeout(startGuardTimer.current);
        startGuardTimer.current = window.setTimeout(() => { startingRef.current = false; }, START_GUARD_MS);
        setAutoStarted(auto);
        onStart();
    };
    const countdown = useAutoStartCountdown({
        armSeq: card?.armSeq ?? 0,
        blocked: !card || !!disabled || typedOpen || isRecording,
        onFire: () => {
            if (startingRef.current) return;
            hapticFeedback.selection?.();
            startOnce(true);
        },
    });
    // The start settled (the mic opened, or it failed and says so): the button may start again.
    useEffect(() => { if (isRecording || error || micRefused) startingRef.current = false; }, [isRecording, error, micRefused]);
    useEffect(() => () => { if (startGuardTimer.current) window.clearTimeout(startGuardTimer.current); }, []);
    useEffect(() => { if (v2On && isRecording) noteMicGranted(); }, [v2On, isRecording]);
    useEffect(() => { setHeldNote(false); }, [card?.armSeq]);

    if (isRecording) {
        const cancel = () => {
            hapticFeedback.medium?.();
            onCancel();
            setJustCancelled(true);
            if (cancelTimer.current) window.clearTimeout(cancelTimer.current);
            cancelTimer.current = window.setTimeout(() => setJustCancelled(false), CANCELLED_NOTE_MS);
        };
        // H1 — an auto-started recording that hears no speech is dropped quietly (the recorder discards a cancelled clip).
        const autoCancel = (reason: AutoCancelReason) => {
            logger.info('voice_v2.mic.autostart_cancelled', { reason });
            if (reason === 'unmeasurable') noteLevelUnmeasurable();
            setHeldNote(true);
            onCancel();
        };
        const stop = () => {
            if (flowV2?.silenceHelp) {
                hapticFeedback.success?.();
                setStamped(true);
                if (stampTimer.current) window.clearTimeout(stampTimer.current);
                stampTimer.current = window.setTimeout(() => setStamped(false), STAMP_MS);
            }
            onStop();
        };
        return (
            <Recording seconds={seconds} level={level} onStop={stop} onCancel={cancel}
                silenceHelp={!!flowV2?.silenceHelp} autoStarted={v2On && autoStarted} onAutoCancel={autoCancel}
                place={card?.placeLabel(language)} />
        );
    }
    if (stamped && flowV2?.silenceHelp) {
        return <SathiRecording seconds={seconds} onStop={onStop} onCancel={onCancel} help={{ stage: 'none', listening: false }} place={card?.placeLabel(language)} stamped />;
    }

    const instruction = disabled ? REC_WORDS.selectCropFirst : MIC_INSTRUCTION;
    return (
        <div className="flex w-full flex-col" style={{ fontFamily: SANS }}>
            {card ? (
                <MicCard spec={card} disabled={disabled} suggest={suggest} secondsLeft={countdown.secondsLeft} total={AUTO_START_SEC} heldNote={heldNote}
                    onMicPress={() => { countdown.hold('tap'); startOnce(false); }}
                    onHold={() => { countdown.hold('link'); setHeldNote(true); }}
                    onRequestContextSelection={onRequestContextSelection} />
            ) : (
            <div role="presentation" onClick={disabled ? onRequestContextSelection : onStart} data-testid="mic-ui" data-recording="no" data-disabled={disabled ? 'yes' : 'no'}
                className={`relative flex w-full cursor-pointer items-center gap-4 overflow-hidden rounded-[28px] border p-3 [@media(max-height:720px)]:p-2 shadow-md ${disabled ? 'border-stone-200 bg-stone-50' : 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-100/60'}`}>
                <button type="button" data-testid="mic-button" aria-label={instruction}
                    className={`group relative z-10 grid h-[88px] w-[88px] [@media(max-height:720px)]:h-[68px] [@media(max-height:720px)]:w-[68px] shrink-0 place-items-center rounded-full outline-none active:scale-95 ${disabled ? 'bg-stone-300 grayscale' : 'bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-xl shadow-emerald-500/40 ring-4 ring-emerald-500/20'}`}>
                    {suggest && !disabled && <span className="absolute inset-0 motion-safe:animate-ping rounded-full border-4 border-emerald-500/30" style={{ animationDuration: '2s' }} />}
                    <span className="pointer-events-none absolute inset-x-3.5 top-2 h-1/2 rounded-full bg-gradient-to-b from-white/40 to-transparent opacity-80" />
                    <Mic strokeWidth={2.25} className="relative h-[52px] w-[52px] text-white drop-shadow-md [@media(max-height:720px)]:h-[40px] [@media(max-height:720px)]:w-[40px]" />
                </button>
                <p className={`m-0 min-w-0 flex-1 text-left text-[17px] [@media(max-height:720px)]:text-[16px] font-extrabold leading-snug ${disabled ? 'text-stone-600' : 'text-emerald-900'}`} data-testid="mic-instruction">{instruction}</p>
            </div>
            )}

            {justCancelled && (
                <p role="status" data-testid="mic-cancelled" className="m-0 mt-2 flex items-center justify-center gap-2 rounded-2xl bg-rose-50 px-3 py-2 text-[16px] font-extrabold text-rose-800">
                    <X size={18} strokeWidth={3} aria-hidden="true" />{REC_WORDS.cancelled}
                </p>
            )}

            {keptNote && (
                <div role="status" data-testid="mic-kept" className="mt-3 w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-emerald-900 shadow-sm">
                    <p className="m-0 flex items-center justify-center gap-2 text-[16px] font-bold"><Check size={20} strokeWidth={3} className="shrink-0" aria-hidden="true" /><span>{keptNote}</span></p>
                </div>
            )}

            {/* F7: with the flow on, an answer with no work (he said something, nothing was found) is Sathi's calm screen, not the red box. */}
            {error && flowV2?.silenceHelp && transcript && !errorCode && <NothingUnderstood transcript={transcript} />}
            {error && !(flowV2?.silenceHelp && transcript && !errorCode) && (
                <div className="mt-3 w-full rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-center text-red-700 shadow-sm" data-testid="mic-error" data-error-code={errorCode ?? undefined}>
                    <p className="m-0 flex items-center justify-center gap-2 text-[16px] font-bold"><AlertCircle size={20} aria-hidden="true" />{REC_WORDS.checkInput}</p>
                    <p className="m-0 mt-1 text-[16px] font-medium">{error}</p>
                    {transcript && (lastInputTyped ? (
                        <p className="m-0 mt-2 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-[15px] text-stone-700" data-testid="mic-error-typed">
                            <TypedTag testId="mic-error-typed-tag" /><span>{transcript}</span>
                        </p>
                    ) : (
                        <p className="m-0 mt-2 rounded-lg border border-stone-200 bg-stone-50 p-2 text-[15px] italic text-stone-600" data-testid="mic-error-heard">"{transcript}"</p>
                    ))}
                </div>
            )}

            {onTextCaptured && <TypedLink strong={micRefused} onClick={() => setTypedOpen(true)} />}
            {onTextCaptured && typedOpen && (
                <TypedSheet
                    onClose={() => setTypedOpen(false)}
                    onSend={(text) => { setTypedOpen(false); if (!disabled) onTextCaptured(text); }}
                />
            )}
        </div>
    );
};

export default RecorderFace;
