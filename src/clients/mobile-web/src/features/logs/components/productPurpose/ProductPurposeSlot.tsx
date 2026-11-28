/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03 final design, row B4; prototype result-v12-final) — Sathi asks what a
 * product was for: "युथेन एम-45 कोणत्या रोगासाठी मारलं?".
 *
 *   - WHICH product: the server says (`GET …/product-purposes`): the card shows only when `mayAnswer` is true, and asks about the
 *     FIRST item whose `ask` is true — one question on this screen. While a product question holds the slot, the day's other
 *     question waits (`children(holdOtherQuestion)`), so Sathi never asks two things at once.
 *   - WHERE: a slot in the page (`data-slot="sathi-question"`). When it scrolls into view the card opens full screen and the page
 *     stops scrolling under it.
 *   - HOW he answers: a chip (the library's targets for that product, in Marathi, and "माहीत नाही"), or the mic on the card (the
 *     phone's own speech recogniser; only in the installed app, P5 — no mic button that cannot listen).
 *   - LETTING GO: four tries to scroll past it without answering, "नंतर", or the phone's back. A let-go is NEVER sent: the product
 *     stays askable, and the slot keeps "आता सांगतो".
 *   - AFTER A REAL ANSWER (200): the meter refetches (`notifyDfesAnswered`, the score moves only on the server), the read is redone,
 *     and the answer shows on the slot and on that product's row (`productPurposeStore`). 409: the answer already stored is shown.
 *     400: read again; a product no longer in the record is not asked. 403 / 404: no card at all.
 * Nothing here invents a number or a promise of one (P4): the score is the meter's own.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { Mic } from 'lucide-react';
import { useBackDismiss } from '../../../../core/navigation/useBackDismiss';
import { getProduct, type CatalogProduct } from '../../../../domain/inputs/inputCatalog';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { DeviceSpeechRecognizer } from '../../../../infrastructure/voice/DeviceSpeechRecognizer';
import { hapticFeedback } from '../../../../shared/utils/haptics';
import type { DailyLog } from '../../../../types';
import { notifyDfesAnswered } from '../../services/dfesAnswerSignal';
import { fetchProductPurposes, postProductPurposeAnswer, type ProductPurposeItem } from '../../services/productPurposeApi';
import { publishProductPurposes } from '../../services/productPurposeStore';
import { answersOf, identityOf } from '../voiceResult/inputIdentityModel';
import { productBoxesOf, productName } from '../voiceResult/productModel';
import { resultCopy } from '../voiceResult/resultCopy';
import { SathiQuestionCard, type AnswerStatus } from '../voiceResult/SathiQuestionCard';
import { useLogSyncState } from '../voiceResult/useRecordingTrust';
import { PRODUCT_PURPOSE_MR as W, purposeAnswerText, purposeChips, purposeQuestion } from './productPurposeWords';

const SANS = "'Noto Sans Devanagari', sans-serif";

/** The design: four tries to scroll past without answering and it lets him go. */
export const LET_GO_AFTER_TRIES = 4;
/** One gesture is one try: moves closer together than this are the same try. */
export const TRY_GAP_MS = 650;
/** How much of the slot must be on screen before the card opens (the design's 0.55). */
export const OPEN_AT = 0.55;

type Read = { state: 'loading' } | { state: 'none' } | { state: 'ok'; mayAnswer: boolean; items: readonly ProductPurposeItem[] };
type Phase = 'waiting' | 'open' | 'later' | 'done';
type Face = { kind: 'ask' } | { kind: 'listening' } | { kind: 'heard'; words: string } | { kind: 'notHeard' };
type Ref = { inputEventId: string; mixIndex: number };

const same = (a: Ref, b: Ref): boolean => a.inputEventId === b.inputEventId && a.mixIndex === b.mixIndex;
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The nearest scrolling ancestor (the voice layer's body), else the page. */
const scrollParentOf = (el: HTMLElement | null): HTMLElement => {
    for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
        const oy = typeof getComputedStyle === 'function' ? getComputedStyle(n).overflowY : '';
        if (oy === 'auto' || oy === 'scroll') return n;
    }
    return document.body;
};

export interface ProductPurposeSlotProps {
    /** The question engine is on (the same switch as the day's question). */
    enabled: boolean;
    farmId: string | null;
    /** The record the question is about. */
    log: DailyLog | undefined;
    /** The rest of the question area; told whether a product question holds the one slot. */
    children?: (holdOtherQuestion: boolean) => React.ReactNode;
}

/** Off (or no farm / record), the rest of the area is drawn exactly as before, with nothing new run. */
export const ProductPurposeSlot: React.FC<ProductPurposeSlotProps> = ({ enabled, farmId, log, children }) => (
    enabled && farmId && log ? <InMarathi farmId={farmId} log={log}>{children}</InMarathi> : <>{children?.(false)}</>
);

/** Marathi mode only: the card's words are Marathi only. */
const InMarathi: React.FC<{ farmId: string; log: DailyLog; children?: ProductPurposeSlotProps['children'] }> = ({ farmId, log, children }) => {
    const language = useOptionalLanguage()?.language;
    if (language === 'en') return <>{children?.(false)}</>;
    return <Asker key={log.id} farmId={farmId} log={log}>{children}</Asker>;
};

const Asker: React.FC<{ farmId: string; log: DailyLog; children?: ProductPurposeSlotProps['children'] }> = ({ farmId, log, children }) => {
    const sync = useLogSyncState([log.id]);
    const [read, setRead] = useState<Read>({ state: 'loading' });
    const [asked, setAsked] = useState<Ref | null>(null);
    const [phase, setPhase] = useState<Phase>('waiting');
    const [face, setFace] = useState<Face>({ kind: 'ask' });
    const [status, setStatus] = useState<AnswerStatus | null>(null);
    const [given, setGiven] = useState<string | null>(null);
    const [nudging, setNudging] = useState(false);
    const alive = useRef(true);
    const busy = useRef(false);
    const tries = useRef(0);
    const lastTry = useRef(0);
    const slotRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

    /** One read of the server; the store is told every time, so the rows show what the server last said. */
    const load = useCallback(async (): Promise<readonly ProductPurposeItem[] | null> => {
        const r = await fetchProductPurposes(farmId, log.id);
        if (!alive.current) return null;
        if (r.kind === 'refused') {
            publishProductPurposes(log.id, []);
            setRead({ state: 'none' });
            setAsked(null);
            return null;
        }
        if (r.kind === 'failed') {
            setRead(prev => (prev.state === 'ok' ? prev : { state: 'none' }));
            return null;
        }
        publishProductPurposes(log.id, r.data.items);
        setRead({ state: 'ok', mayAnswer: r.data.mayAnswer, items: r.data.items });
        // ONE product per screen: the first the server asks about, fixed once chosen.
        const first = r.data.mayAnswer ? r.data.items.find(i => i.ask) : undefined;
        setAsked(prev => prev ?? (first ? { inputEventId: first.inputEventId, mixIndex: first.mixIndex } : null));
        return r.data.items;
    }, [farmId, log.id]);

    useEffect(() => { void load(); }, [load]);
    // Just after the save the record may not be on the server yet: read once more when it GETS there, if nothing is asked yet.
    const reachedServer = useRef(sync === 'onServer');
    useEffect(() => {
        if (sync !== 'onServer' || reachedServer.current) return;
        reachedServer.current = true;
        if (!asked) void load();
    }, [sync, asked, load]);

    const item = read.state === 'ok' && asked ? read.items.find(i => same(i, asked)) ?? null : null;
    const itemKey = item ? `${item.inputEventId}:${item.mixIndex}` : null;

    // What the product is: the phone's own row (his word for it), the library entry the server named, else the phone's own match.
    const phoneItem = useMemo(
        () => (asked ? productBoxesOf(log).flatMap(b => b.items).find(i => !!i.ref && same({ inputEventId: i.ref.eventId, mixIndex: i.ref.mixIndex }, asked)) : undefined),
        [log, asked],
    );
    const product: CatalogProduct | undefined = useMemo(() => {
        const byId = item?.catalogProductId ? getProduct(item.catalogProductId) : undefined;
        if (byId || !phoneItem) return byId;
        const identity = identityOf(phoneItem, answersOf(log, phoneItem.ref));
        return identity.state === 'found' ? identity.product : undefined;
    }, [item?.catalogProductId, phoneItem, log]);
    const brandMr = item ? product?.brands.find(b => b.mr && b.en && squash(b.en) === squash(item.productName))?.mr ?? undefined : undefined;
    const name = (phoneItem ? productName(phoneItem, 'mr') : '') || brandMr || phoneItem?.matchName || item?.productName || '';
    const question = purposeQuestion(name, product?.category);
    const chips = useMemo(() => purposeChips(product?.targets), [product]);
    const canSpeak = Capacitor.isNativePlatform();
    const open = phase === 'open';

    const openCard = useCallback(() => {
        tries.current = 0;
        lastTry.current = 0;
        setFace({ kind: 'ask' });
        setStatus(null);
        setNudging(false);
        setPhase('open');
        hapticFeedback.medium();
    }, []);

    /** He goes on without answering. Nothing is sent (the server would refuse it, and the product must stay askable). */
    const letGo = useCallback(() => {
        if (busy.current) return; // never while the mic listens or an answer is being kept
        setPhase('later');
        setFace({ kind: 'ask' });
        setNudging(false);
    }, []);
    useBackDismiss(open, letGo);

    const nudge = useCallback(() => {
        const now = Date.now();
        if (now - lastTry.current < TRY_GAP_MS) return;
        lastTry.current = now;
        tries.current += 1;
        if (tries.current >= LET_GO_AFTER_TRIES && !busy.current) { letGo(); return; }
        hapticFeedback.selection();
        setNudging(true);
    }, [letGo]);
    useEffect(() => {
        if (!nudging) return;
        const t = setTimeout(() => setNudging(false), 1800);
        return () => clearTimeout(t);
    }, [nudging]);

    // The page under the card does not scroll while it is open.
    useEffect(() => {
        if (!open) return;
        const els = [scrollParentOf(slotRef.current), document.body];
        const before = els.map(el => el.style.overflowY);
        els.forEach(el => { el.style.overflowY = 'hidden'; });
        return () => { els.forEach((el, i) => { el.style.overflowY = before[i]; }); };
    }, [open]);

    // A try to scroll past the card: it does not move the page; it counts, and it says why.
    useEffect(() => {
        const el = overlayRef.current;
        if (!open || !el) return;
        const block = (e: Event) => { e.preventDefault(); nudge(); };
        let y0: number | null = null;
        const down = (e: PointerEvent) => { y0 = e.clientY; };
        const move = (e: PointerEvent) => { if (y0 !== null && Math.abs(e.clientY - y0) > 18) { y0 = null; nudge(); } };
        const up = () => { y0 = null; };
        el.addEventListener('wheel', block, { passive: false });
        el.addEventListener('touchmove', block, { passive: false });
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        return () => {
            el.removeEventListener('wheel', block);
            el.removeEventListener('touchmove', block);
            el.removeEventListener('pointerdown', down);
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
        };
    }, [open, nudge]);

    // The card opens when the slot scrolls into view — once; after a let-go only his own "आता सांगतो" opens it again.
    const canObserve = typeof IntersectionObserver !== 'undefined';
    useEffect(() => {
        const el = slotRef.current;
        if (phase !== 'waiting' || !itemKey || !el || !canObserve) return;
        const io = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting && e.intersectionRatio >= OPEN_AT)) openCard();
        }, { threshold: OPEN_AT });
        io.observe(el);
        return () => io.disconnect();
    }, [phase, itemKey, canObserve, openCard]);

    const send = async (answer: { mode: 'chip'; code: string; words: string } | { mode: 'voice'; words: string }) => {
        if (!item || busy.current) return;
        busy.current = true;
        setStatus('saving');
        const result = await postProductPurposeAnswer({ farmId, dailyLogId: log.id, inputEventId: item.inputEventId, mixIndex: item.mixIndex, promptText: question, ...answer });
        busy.current = false;
        if (!alive.current) return;
        switch (result.kind) {
            case 'stored':
                hapticFeedback.success();
                setStatus('kept');
                setGiven(answer.words);
                notifyDfesAnswered(); // the meter reads its score again: it moves only if the server moved it
                await load();
                if (alive.current) setPhase('done');
                return;
            case 'conflict':
                // A different answer was already kept: show THAT one (read back), never his new one as if kept.
                await load();
                if (alive.current) setPhase('done');
                return;
            case 'notInRecord': {
                const items = await load();
                if (!alive.current) return;
                const now = items?.find(i => same(i, item));
                if (now?.ask) { setStatus('failed'); return; }
                if (now?.answer) { setPhase('done'); return; }
                setAsked(null); // no longer in the record: not asked
                setPhase('waiting');
                return;
            }
            case 'refused':
                publishProductPurposes(log.id, []);
                setRead({ state: 'none' });
                setAsked(null);
                setPhase('waiting');
                return;
            default:
                hapticFeedback.error();
                setStatus('failed');
        }
    };

    const listen = async () => {
        if (busy.current || !canSpeak) return;
        busy.current = true;
        setStatus(null);
        setFace({ kind: 'listening' });
        const r = await new DeviceSpeechRecognizer().transcribe({ language: 'mr-IN' });
        busy.current = false;
        if (!alive.current) return;
        const words = 'transcript' in r ? r.transcript.trim() : '';
        setFace(words ? { kind: 'heard', words } : { kind: 'notHeard' });
    };

    const hold = read.state === 'loading' || !!item;
    // The same three places either way (slot, the rest, card), so the rest is never remounted when the slot comes or goes.
    if (!item) return <>{null}{children?.(hold)}{null}</>;

    const copy = resultCopy('mr');
    const typeName = product ? copy.typeNames[product.category] : null;
    const answered = item.answer ? purposeAnswerText(item.answer) : given;

    const slot = (
        <div ref={slotRef} data-slot="sathi-question" data-testid="pq-slot" data-state={phase} style={{ fontFamily: SANS }}
            className={`rounded-[22px] border-[1.5px] p-3.5 ${phase === 'done' ? 'border-[#B7E4C7] bg-[#E9F8EE]' : 'border-[#F3D27A] bg-[#FFFBEA]'}`}>
            {phase === 'done' ? (
                <>
                    <small className="block text-[13px] font-extrabold text-[#14532D]">{W.answered}</small>
                    <b className="block text-[17px] font-extrabold leading-snug text-[#1C1917]" data-testid="pq-slot-answer">{answered ? `${name} · ${answered}` : name}</b>
                </>
            ) : (
                <>
                    <p className="m-0 text-[13px] font-extrabold text-amber-900">{W.head}</p>
                    <p className="m-0 mt-1 text-[17px] font-extrabold leading-snug text-amber-950" data-testid="pq-slot-question">{question}</p>
                    {phase === 'later' && <p className="m-0 mt-1 text-[14px] font-bold text-[#5F6B63]" data-testid="pq-slot-later">{W.later}</p>}
                    {(phase === 'later' || (phase === 'waiting' && !canObserve)) && (
                        <button type="button" onClick={openCard} data-testid="pq-tell-now"
                            className="mt-2 flex min-h-[48px] items-center gap-2 rounded-2xl bg-emerald-700 px-4 text-[16px] font-extrabold text-white active:scale-[0.98]">
                            <Mic size={20} aria-hidden="true" />{W.tellNow}
                        </button>
                    )}
                </>
            )}
        </div>
    );

    const card = open && typeof document !== 'undefined' ? createPortal(
        <div ref={overlayRef} role="dialog" aria-modal="true" aria-labelledby="pq-question" data-testid="pq-overlay"
            className="fixed inset-0 z-[60] flex items-stretch justify-center bg-[rgba(6,40,24,0.55)] p-2.5"
            style={{ touchAction: 'none', fontFamily: SANS, paddingTop: 'calc(0.75rem + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))', paddingBottom: 'calc(0.75rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))' }}>
            <div data-testid="pq-card" className="flex w-full max-w-md flex-col gap-3 overflow-hidden rounded-[28px] border-[2.5px] border-[#F3D27A] bg-[#FFFDF6] p-4 shadow-[0_24px_50px_rgba(0,0,0,0.35)]">
                <p className="m-0 text-[15px] font-extrabold text-amber-900">{W.head}</p>
                <div className="flex items-center gap-2" data-testid="pq-product">
                    <b className="text-[18px] font-extrabold text-[#1C1917]">{name}</b>
                    {typeName && <em className="rounded-full bg-white px-[9px] py-px text-[12px] font-extrabold not-italic text-stone-700 shadow-[inset_0_0_0_1px_currentColor]">{typeName}</em>}
                </div>
                <span id="pq-question" className="sr-only">{question}</span>
                {face.kind === 'listening' ? (
                    <div className="flex flex-col items-center gap-3 py-4" data-testid="pq-listening">
                        <p className="m-0 text-[20px] font-extrabold leading-snug text-amber-950">{question}</p>
                        <span className="grid h-[120px] w-[120px] place-items-center rounded-full bg-emerald-700 text-white motion-safe:animate-pulse"><Mic size={48} aria-hidden="true" /></span>
                        <p className="m-0 text-[16px] font-extrabold text-[#0F6B3A]">{W.micListening}</p>
                    </div>
                ) : face.kind === 'heard' ? (
                    <div className="flex flex-col gap-3" data-testid="pq-heard">
                        <p className="m-0 text-[17px] font-extrabold leading-snug text-amber-950">{question}</p>
                        <div className="rounded-2xl border-[1.5px] border-[#B7E4C7] bg-[#E9F8EE] px-3 py-2.5">
                            <small className="block text-[13px] font-extrabold text-[#14532D]">{W.youSaid}</small>
                            <b className="block text-[18px] font-extrabold leading-snug text-[#1C1917]" data-testid="pq-heard-words">“{face.words}”</b>
                        </div>
                        {status && (
                            <p role="status" data-testid="pq-status" data-state={status}
                                className={`m-0 text-[15px] font-extrabold ${status === 'failed' ? 'text-red-800' : 'text-emerald-900'}`}>
                                {{ saving: copy.answerSaving, queued: copy.answerQueued, kept: copy.answerKept, failed: copy.answerNotKept }[status]}
                            </p>
                        )}
                        {status !== 'kept' && (
                            <div className="flex flex-col gap-2.5">
                                <button type="button" data-testid="pq-heard-yes" disabled={status === 'saving'} onClick={() => { void send({ mode: 'voice', words: face.words }); }}
                                    className="min-h-[60px] rounded-[18px] bg-[#0F6B3A] text-[19px] font-extrabold text-white disabled:opacity-60">{W.yesRight}</button>
                                <button type="button" data-testid="pq-heard-again" disabled={status === 'saving'} onClick={() => { void listen(); }}
                                    className="flex min-h-[60px] items-center justify-center gap-2 rounded-[18px] border-2 border-[#E5E7E1] bg-white text-[19px] font-extrabold text-[#292524] disabled:opacity-60">
                                    <Mic size={22} aria-hidden="true" />{W.sayAgain}
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {face.kind === 'notHeard' && <p className="m-0 text-[15px] font-extrabold text-red-800" data-testid="pq-not-heard">{W.nothingHeard}</p>}
                        <SathiQuestionCard
                            prompt={question}
                            options={chips.map(c => ({ value: c.code, labelMr: c.label }))}
                            onAnswer={o => { void send({ mode: 'chip', code: o.value, words: o.labelMr }); }}
                            onLater={letGo}
                            onSpeak={() => { void listen(); }}
                            speakToo={canSpeak}
                            answerStatus={status}
                        />
                    </>
                )}
                <p aria-live="polite" data-testid="pq-nudge" data-on={nudging ? 'yes' : 'no'}
                    className={`m-0 self-center rounded-full border-[1.5px] border-[#FDBA74] bg-[#FFEDD5] px-3 py-1 text-[14px] font-extrabold text-[#9A3412] transition-opacity ${nudging ? 'opacity-100' : 'opacity-0'}`}>
                    {W.nudge}
                </p>
            </div>
        </div>,
        document.body,
    ) : null;

    return (
        <>
            {slot}
            {children?.(hold)}
            {card}
        </>
    );
};

export default ProductPurposeSlot;
