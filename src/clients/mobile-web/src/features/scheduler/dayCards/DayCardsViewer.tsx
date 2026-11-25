/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8; approved spec plr-d10-schedule-approved-spec-2026-11-23, "One viewer")
 *
 * The ONE full-screen viewer of the day cards, opened from the schedule page, from planning and from a job card, always with a back on top (the back button and the
 * phone's hardware Back both close it). It gets either a schedule version to read (this phone's copy first, the server when there is signal) or a detail already in
 * hand (an own work on the phone), and either a SHOWN day or one work's key. Sound and buzz are the farmer's own switches, off until he turns them on; reduced motion
 * is respected (no smooth scroll). Works at 320, 375 and 400 px: one column, 16 px gutters, 44 px targets.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, ChevronLeft, ChevronRight, Volume2, VolumeX, X } from 'lucide-react';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { useUiPref } from '../../../shared/hooks/useUiPref';
import { DayCardDeck, positionText } from './DayCardDeck';
import { deckForShownDay, deckForTask, firstShownDay, lastShownDay, type CardPart } from './dayCardsModel';
import { loadDayCards, type DayCardsLoad } from './dayCardsStore';
import type { DayCardsDetail } from './dayCardsTypes';
import { dayCardWords, type DayCardWords } from './dayCardWords';
import type { TakeHost } from '../ownSchedule/TakeIntoMyScheduleButton';
import { withOwnerCards } from '../ownerVoice/ownerVoiceModel';
import { useOwnerClipPrefetch, useOwnerVoiceHost, useOwnerVoiceView } from '../ownerVoice/useOwnerVoice';

export type DayCardsTarget = { day: number } | { taskKey: string };
export type DayCardsSource = { templateId: string } | { detail: DayCardsDetail };

// The farmer's own switches live in the UI prefs (Dexie), never in localStorage (check:storage-discipline). Both start OFF.
const SOUND_PREF = 'dayCards.sound';
const BUZZ_PREF = 'dayCards.buzz';

interface Switches { sound: boolean; buzz: boolean }

export const prefersReducedMotion = (): boolean => {
    try { return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; }
};

/** The deck for a target, or null when this version has no such day-card content (shown to the farmer as "no card for this work"). */
export function deckFor(detail: DayCardsDetail, target: DayCardsTarget): CardPart[] | null {
    return 'day' in target ? deckForShownDay(detail, target.day) : deckForTask(detail, target.taskKey);
}

const titleOf = (part: CardPart | undefined): string => {
    if (!part) return '';
    if (part.type === 'challenge') return part.challenge.title;
    if (part.type === 'day') return '';
    return part.task.task.name;
};

export const DayCardsViewer: React.FC<{ source: DayCardsSource; target: DayCardsTarget; onClose: () => void; load?: (id: string) => Promise<DayCardsLoad>; /** Slice 9: given only by the schedule page's door (a followed schedule of a place); absent = the deck is exactly as it was. */ take?: TakeHost }> = ({ source, target, onClose, load = loadDayCards, take }) => {
    useBackDismiss(true, onClose);
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words: DayCardWords = dayCardWords(language);
    const [state, setState] = useState<DayCardsLoad | null>(() => ('detail' in source ? { ok: true, detail: source.detail, source: 'phone', stale: false } : null));
    const [attempt, setAttempt] = useState(0);
    const [sound, setSound] = useUiPref<boolean>(SOUND_PREF, false);
    const [buzz, setBuzz] = useUiPref<boolean>(BUZZ_PREF, false);
    const switches = useMemo<Switches>(() => ({ sound: sound === true, buzz: buzz === true }), [sound, buzz]);
    const [answer, setAnswer] = useState<{ changes: string | null } | null>(null);
    const [active, setActive] = useState(0);
    const lastActive = useRef(0);
    const scroller = useRef<HTMLDivElement | null>(null);
    // A day target can step to the day before and after (the farmer looks ahead, or back): the work target is one work and does not.
    const targetDay = 'day' in target ? target.day : null;
    const targetKey = 'taskKey' in target ? target.taskKey : null;
    const [day, setDay] = useState<number | null>(targetDay);
    const templateId = 'templateId' in source ? source.templateId : null;

    useEffect(() => {
        if (!templateId) return undefined;
        let alive = true;
        setState(null);
        void load(templateId).then(r => { if (alive) setState(r); });
        return () => { alive = false; };
    }, [templateId, attempt, load]);

    const detail = state?.ok ? state.detail : null;
    // Slice 12b: the schedule owner's voice for the plot the page named (none when no door named one: then the deck is exactly as it was).
    const voiceHost = useOwnerVoiceHost();
    const voiceView = useOwnerVoiceView(voiceHost !== null);
    useOwnerClipPrefetch(voiceHost?.farmId, voiceView.messages);
    const voice = useMemo(() => (voiceHost ? { host: voiceHost, view: voiceView } : undefined), [voiceHost, voiceView]);
    const parts = useMemo(() => {
        const base = detail ? deckFor(detail, day !== null ? { day } : { taskKey: targetKey ?? '' }) : null;
        return base && detail && voiceHost ? withOwnerCards(base, detail, voiceView.messages) : base;
    }, [detail, targetKey, day, voiceHost, voiceView.messages]);
    const lastDay = detail ? lastShownDay(detail) : 1;
    const firstDay = detail ? firstShownDay(detail) : 1;
    const step = (by: number) => {
        setDay(d => (d === null ? d : Math.min(lastDay, Math.max(firstDay, d + by))));
        setActive(0);
        lastActive.current = 0;
        scroller.current?.scrollTo?.({ top: 0, behavior: 'auto' });
    };

    const onScroll = useCallback(() => {
        const el = scroller.current;
        if (!el || el.clientHeight === 0) return;
        const next = Math.round(el.scrollTop / el.clientHeight);
        setActive(prev => (prev === next ? prev : next));
    }, []);

    // The farmer's own switches: a buzz when a card settles, the card's title read aloud. Both are off until he turns them on, and both are only ever a nicety.
    useEffect(() => {
        if (active === lastActive.current) return;
        lastActive.current = active;
        if (switches.buzz) { try { navigator.vibrate?.(12); } catch { /* no vibration on this phone */ } }
        if (switches.sound && parts) {
            const line = titleOf(parts[active]);
            if (line && typeof window !== 'undefined' && 'speechSynthesis' in window) {
                try {
                    window.speechSynthesis.cancel();
                    const u = new SpeechSynthesisUtterance(line);
                    u.lang = language === 'en' ? 'en-IN' : 'mr-IN';
                    window.speechSynthesis.speak(u);
                } catch { /* no voice on this phone */ }
            }
        }
    }, [active, parts, switches, language]);
    useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch { /* none */ } }, []);

    const flip = (key: keyof Switches) => {
        if (key === 'sound') setSound(!switches.sound);
        else setBuzz(!switches.buzz);
    };

    const nextLine = parts && parts[active + 1] ? titleOf(parts[active + 1]) : '';
    const failedLine = state && !state.ok ? words.unavailable : null;

    return (
        <div className="fixed inset-0 z-[70] flex justify-center bg-stone-900/40" data-testid="day-cards-viewer">
            <div className="flex h-full w-full max-w-md flex-col bg-stone-100" role="dialog" aria-modal="true" aria-label={detail?.name ?? words.how}>
                <div className="flex shrink-0 items-center gap-2 border-b border-stone-200 bg-white px-3 py-2">
                    <button type="button" onClick={onClose} data-testid="day-cards-back" aria-label={words.back}
                        className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border border-stone-300 bg-white pl-2 pr-4 text-[16px] font-extrabold text-stone-800">
                        <X size={20} strokeWidth={2.75} aria-hidden />{words.close}
                    </button>
                    <div className="min-w-0 flex-1">
                        {nextLine && <p className="truncate text-[11px] font-extrabold text-stone-500">{words.next}: {nextLine}</p>}
                        <p className="truncate text-[15px] font-black text-stone-900">{titleOf(parts?.[active]) || detail?.name || ''}</p>
                    </div>
                    <button type="button" onClick={() => flip('buzz')} aria-pressed={switches.buzz} aria-label={`${words.buzz}: ${switches.buzz ? words.on : words.off}`} data-testid="switch-buzz"
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-800">{switches.buzz ? <Bell size={20} aria-hidden /> : <BellOff size={20} aria-hidden />}</button>
                    <button type="button" onClick={() => flip('sound')} aria-pressed={switches.sound} aria-label={`${words.sound}: ${switches.sound ? words.on : words.off}`} data-testid="switch-sound"
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-800">{switches.sound ? <Volume2 size={20} aria-hidden /> : <VolumeX size={20} aria-hidden />}</button>
                </div>

                {day !== null && detail && (
                    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-stone-200 bg-white px-3 py-1" data-testid="day-stepper">
                        <button type="button" onClick={() => step(-1)} disabled={day <= firstDay} data-testid="day-prev" aria-label={positionText(Math.max(firstDay, day - 1), words)}
                            className="grid h-11 w-11 place-items-center rounded-full bg-stone-100 text-stone-800 disabled:opacity-30"><ChevronLeft size={22} aria-hidden /></button>
                        <p className="text-[17px] font-black text-stone-900" data-testid="day-stepper-day">{positionText(day, words)}</p>
                        <button type="button" onClick={() => step(1)} disabled={day >= lastDay} data-testid="day-next" aria-label={positionText(Math.min(lastDay, day + 1), words)}
                            className="grid h-11 w-11 place-items-center rounded-full bg-stone-100 text-stone-800 disabled:opacity-30"><ChevronRight size={22} aria-hidden /></button>
                    </div>
                )}
                <div ref={scroller} onScroll={onScroll} data-testid="day-cards-scroller"
                    className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto overscroll-contain"
                    style={{ scrollBehavior: prefersReducedMotion() ? 'auto' : 'smooth' }}>
                    {!state && <p className="p-6 text-center text-[17px] font-bold text-stone-600" data-testid="day-cards-loading">{words.loading}</p>}
                    {failedLine && (
                        <div className="space-y-3 p-6 text-center" data-testid="day-cards-unavailable">
                            <p className="text-[17px] font-bold text-stone-700">{failedLine}</p>
                            <button type="button" onClick={() => setAttempt(a => a + 1)} className="min-h-[44px] rounded-full bg-stone-900 px-5 text-[16px] font-extrabold text-white">{words.retry}</button>
                        </div>
                    )}
                    {detail && !parts && <p className="p-6 text-center text-[17px] font-bold text-stone-700" data-testid="day-cards-none">{words.nothingHere}</p>}
                    {detail && parts && <DayCardDeck parts={parts} detail={detail} words={words} onAnswer={changes => setAnswer({ changes })} take={take} voice={voice} />}
                </div>

                {detail && parts && <p className="shrink-0 bg-stone-100 py-1 text-center text-[11px] font-extrabold text-stone-500">{words.swipeHint}</p>}

                {answer && (
                    <div className="absolute inset-x-0 bottom-0 z-10 mx-auto max-w-md rounded-t-3xl bg-white p-4 shadow-2xl" role="dialog" aria-modal="true" data-testid="answer-sheet">
                        <p className="text-[13px] font-extrabold text-stone-500">{words.answerChanges}</p>
                        <p className="mt-1 text-[19px] font-bold leading-snug text-stone-900">{answer.changes ?? words.answerNothing}</p>
                        <button type="button" onClick={() => setAnswer(null)} className="mt-3 min-h-[48px] w-full rounded-2xl bg-stone-900 text-[18px] font-black text-white">{words.close}</button>
                    </div>
                )}
            </div>
        </div>
    );
};
