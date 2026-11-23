/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 11; amendments H2, H3, H7, M4) — the ONE saved screen he sees first after he speaks, built
 * only from the result screen's existing pieces (the founder-approved look, `savedc`). Presentational: the container owns the
 * audio, the sync read-out and the answers. Top to bottom:
 *   1. the red mix banner (the verdicts derived on read, as on the result screen); place, day (the existing move-day chip) and
 *      how many times he told it today; who told it today;
 *   2. ONE card: the title says only what the sync state says (P10) — "लक्षात ठेवलं ✓" while it is on this phone, the server's
 *      claim only once the server acknowledged it; the badges; his voice, big ("तुमचा आवाज ऐका"), or the typed note; the meter
 *      (the SERVER's score only, its own parts left to this screen: `ResultHero parts={false}`, P4);
 *   3. "तुम्ही काय दिलं" (`SavedGiven`), the eight parts (`SavedPartsGrid`), what stopped the work;
 *   4. his words, the question, the speaker's line, the extras, "बदला", the earlier recordings, the detail button
 *      (`SavedScreenLower`);
 *   5. the bottom bar: the big mic and the 30-second self-close (`IdleCloseBar`), held while a clip plays, the product card or
 *      the day sheet or any overlay is open, and off when the container says so.
 * No "पक्कं आहे" here (it stays on the detail page), no projected number, no save call.
 */
import React, { useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, MapPin } from 'lucide-react';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { openOverlayCount } from '../../../../core/navigation/backStack';
import { NotQueuedForServerBadge } from '../../../../core/navigation/mainViewComponents';
import { SHIPPABLE_RULES, type MixRule } from '../../../../domain/inputs/mixVerdict';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { dayRel, dayShort } from '../dayPick/dayWords';
import type { RingNodeData } from '../shramsathi/understandingRing';
import ClipPlayer from '../voiceResult/ClipPlayer';
import { BlockerRow, LegacyNote, TimePill, TypedNote, TypedTag, WhoChip } from '../voiceResult/DayParts';
import { dayLinesOf, lineKeyOfVerdict } from '../voiceResult/DaySummaryLines';
import { MixBanner, tankVerdictsOf } from '../voiceResult/MixBox';
import ProductCard, { type ProductAnswerKit } from '../voiceResult/ProductCard';
import type { ProductItem } from '../voiceResult/productModel';
import ResultHero from '../voiceResult/ResultHero';
import { resultCopy } from '../voiceResult/resultCopy';
import type { DayView, PartKey, RecordingView } from '../voiceResult/resultModel';
import { resultDayStr, resultStr, useResultStr } from '../voiceResult/resultStrings';
import { scrollBelowHeader } from '../voiceResult/scrollBelowHeader';
import type { LogSyncState } from '../voiceResult/useRecordingTrust';
import IdleCloseBar from './IdleCloseBar';
import { BOTTOM_BAR_CLEARANCE } from '../../../../shared/utils/bottomBar';
import SavedGiven from './SavedGiven';
import SavedPartsGrid from './SavedPartsGrid';
import SavedScreenLower from './SavedScreenLower';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface SavedScreenProps {
    day: DayView;
    recordingKey: string;
    placeLabel: string | ((language: string | undefined) => string);
    farmId: string | null;
    nodes: RingNodeData[];
    unclear: readonly string[];
    clips: ReadonlyMap<string, VoiceClipCacheRecord>;
    playingId: string | null;
    progress: number;
    lengthOf: (logId: string) => number | null;
    onTogglePlay: (logId: string) => void;
    sync: LogSyncState;
    syncQueuedOf: (logId: string) => boolean | null | undefined;
    confirmed: boolean;
    onEdit: (logId: string) => void;
    onAddAnother: () => void;
    onTellMore: (part: PartKey) => void;
    /** The day chip opens the calendar (the container's existing move-day); absent = the day is shown, not offered. */
    onChangeDay?: () => void;
    /** The container's day sheet is open: the close clock is held. */
    pickingDay?: boolean;
    questionPanel?: React.ReactNode;
    extras?: React.ReactNode;
    answerKit?: ProductAnswerKit;
    mixRules?: readonly MixRule[];
    /** Why this screen must NOT close itself (the container's honesty rules); null = it closes after 30 s untouched. */
    autoCloseOff: string | null;
    onOpenDetail: () => void;
    onAutoClose: () => void;
}

/** The title's claim: only what the sync state says (P10). */
export const savedClaimOf = (sync: LogSyncState, RS: { remembered: string; onServer: string }): string =>
    (sync === 'onServer' ? RS.onServer : RS.remembered);

/**
 * The closing toast: the title's claim, then where to see it again (the tail of `closedToast`; its own head "आजचं काम जतन झालं ✓"
 * would claim more than the phone knows while the record is only on it — H2).
 */
export const closedToastOf = (sync: LogSyncState, language: string | null | undefined): string => {
    const full = voiceFlowWords(language).closedToast;
    const at = full.indexOf(' — ');
    return `${savedClaimOf(sync, resultStr(language))} — ${at >= 0 ? full.slice(at + 3) : full}`;
};

const overlayOpen = (): boolean => openOverlayCount() > 0;

export const SavedScreen: React.FC<SavedScreenProps> = (p) => {
    const { day } = p;
    const primary: RecordingView | undefined = day.current.find(r => !!r.transcript) ?? day.current[0];
    const [card, setCard] = useState<{ item: ProductItem; logId: string } | null>(null);
    const root = useRef<HTMLDivElement>(null);
    const wordsRef = useRef<HTMLDivElement>(null);
    const kit = p.answerKit;
    const rules = p.mixRules ?? SHIPPABLE_RULES;
    // The day's tank verdicts, derived on read from the records on this screen (as `VoiceResultScreen` does); nothing is stored.
    const verdicts = useMemo(() => {
        if (!kit) return [];
        const ids = [...new Set([...day.current, ...day.earlier].flatMap(r => r.logIds))];
        return ids.flatMap(id => tankVerdictsOf(kit.logById.get(id), rules));
    }, [kit, day, rules]);
    const reds = useMemo(() => verdicts.filter(v => v.result.state === 'red'), [verdicts]);
    const language = useOptionalLanguage()?.language;
    const RS = useResultStr();
    if (!primary) return null;
    const W = voiceFlowWords(language);
    const copy = resultCopy(language);
    const DS = resultDayStr(language);
    const nd = (text: string): string => digitsFor(text, language);
    const onDay = primary.log.date && primary.log.date !== getDateKey() ? nd(dayShort(primary.log.date, language)) : null;
    const count = day.earlier.filter(r => !r.byForm).length + 1;
    const severalPlots = day.current.length > 1;
    const clip = p.clips.get(primary.id);
    const plotIds = [...new Set((primary.log.context?.selection ?? []).flatMap(s => s.selectedPlotIds ?? []).filter(Boolean))];
    const nowLines = dayLinesOf(day, language, 'now');
    const redHint = (() => {
        const v = reds[0];
        const lines = dayLinesOf(day, language);
        const box = v ? lines.find(l => l.key === lineKeyOfVerdict(lines, v))?.box : undefined;
        const kind = box ? (box.kind === 'spray' ? copy.spray : box.kind === 'drip' ? copy.drip : copy.products) : '';
        return [kind, copy.mixBannerHint].filter(Boolean).join(' · ');
    })();
    // The banner brings this recording's tank into view; a wrong mix of an earlier recording is on the detail page's day list.
    const openRed = (v: (typeof reds)[number]) => {
        const key = nowLines.find(l => l.key === `inputs:${v.hostEventId}`)?.key;
        const el = key ? root.current?.querySelector<HTMLElement>(`[data-testid="vr2-given-${key}"]`) : null;
        if (el) scrollBelowHeader(el); else p.onOpenDetail();
    };
    const pauseReason = p.playingId ? 'clip' : card ? 'product' : p.pickingDay ? 'day' : null;
    const dayText = nd(dayRel(primary.log.date, getDateKey(), language));

    return (
        <div ref={root} className="space-y-3 pt-1" style={{ fontFamily: SANS }} data-testid="vr2-saved">
            <MixBanner reds={reds} hint={redHint} onOpen={openRed} />
            <div className="flex flex-wrap items-center gap-2" data-testid="vr2-head">
                <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-sm font-extrabold text-stone-800" data-testid="vr2-place"><MapPin size={16} aria-hidden="true" />{typeof p.placeLabel === 'function' ? p.placeLabel(language) : p.placeLabel}</span>
                {p.onChangeDay ? (
                    <button type="button" onClick={p.onChangeDay} data-testid="vr2-day" className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-extrabold text-stone-800"><CalendarDays size={16} aria-hidden="true" />{dayText}</button>
                ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm font-extrabold text-stone-700" data-testid="vr2-day"><CalendarDays size={16} aria-hidden="true" />{dayText}</span>
                )}
                <span className="text-xs font-bold text-stone-600" data-testid="vr2-count">{onDay ? (count > 1 ? nd(DS.count(count, onDay)) : DS.first(onDay)) : count > 1 ? nd(RS.todayCount(count)) : RS.firstToday}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-stone-200 bg-white px-2.5 py-1.5" data-testid="vr2-speakers">
                <span className="text-[12px] font-extrabold text-stone-700">{onDay ? DS.who(onDay) : RS.todayWho}:</span>
                {day.speakers.map(s => (
                    <span key={`${s.you}-${s.name}`} data-you={s.you ? 'yes' : 'no'}
                        className={`rounded-full border px-2 py-0.5 text-[12px] font-extrabold ${s.you ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-blue-300 bg-blue-50 text-blue-900'}`}>
                        {s.name} · {nd(RS.times(s.times))}
                    </span>
                ))}
            </div>

            <section className="space-y-2.5 rounded-3xl border-2 border-emerald-600 bg-white p-3" data-testid="vr2-saved-card">
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white motion-safe:animate-plr-rise"><Check size={24} strokeWidth={3} aria-hidden="true" /></span>
                    <b className="text-[21px] font-extrabold leading-tight text-emerald-900" data-testid="vr2-saved-title" data-sync={p.sync}>{savedClaimOf(p.sync, RS)}</b>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-extrabold" data-testid="vr2-badges">
                    <span className="rounded-full bg-emerald-700 px-2.5 py-1 text-white">{RS.justNow}</span>
                    <TimePill label={primary.timeLabel} strong />
                    <WhoChip who={primary.who} testId="vr2-latest-who" />
                    {primary.typed && <TypedTag testId="vr2-latest-typed" />}
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800" data-testid="vr2-remembered">{RS.remembered}</span>
                    {p.sync === 'onServer' && <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-800" data-testid="vr2-on-server">{RS.onServer}</span>}
                    {p.sync === 'needsFix' && <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-amber-800" data-testid="vr2-needs-fix">{RS.needsFix}</span>}
                    {p.confirmed
                        ? <span className="rounded-full bg-emerald-900 px-2.5 py-1 text-white" data-testid="vr2-confirmed-badge">{RS.confirmedBadge}</span>
                        : <span className="rounded-full border border-stone-300 bg-stone-50 px-2.5 py-1 text-stone-700" data-testid="vr2-not-confirmed-badge">{RS.notConfirmed}</span>}
                </div>
                {!severalPlots && <NotQueuedForServerBadge syncQueued={p.syncQueuedOf(primary.id)} />}
                {primary.legacyPartial && <LegacyNote testId="vr2-legacy-note" />}
                {primary.typed ? <TypedNote /> : clip && (
                    <div data-testid="vr2-listen">
                        <div className="text-[15px] font-extrabold text-stone-900">{W.listenTitle}</div>
                        <div className="mb-1.5 text-[12.5px] font-semibold text-stone-600">{W.listenSub}</div>
                        <ClipPlayer clipKey={clip.id} durationSec={p.lengthOf(primary.id)} playing={p.playingId === primary.id} progress={p.progress} big
                            onToggle={() => p.onTogglePlay(primary.id)} testId="vr2-play" nativeDigits={language !== 'en'} />
                    </div>
                )}
                <ResultHero farmId={p.farmId} dayDate={primary.log.date} plotId={plotIds.length === 1 ? plotIds[0] : null} savedLogId={primary.id}
                    recordingKey={p.recordingKey} nodes={p.nodes} missing={day.missing} unsure={day.unsure} onTellMore={p.onTellMore}
                    onReadMore={() => scrollBelowHeader(wordsRef.current)} onSettled={() => undefined} typed={primary.typed} parts={false} />
            </section>

            <SavedGiven day={day} kit={kit} verdicts={verdicts} onOpen={kit ? (item, logId) => setCard({ item, logId }) : () => undefined} />
            <SavedPartsGrid day={day} onTellMore={p.onTellMore} />
            {day.blockersNow.length > 0 && (
                <div className="space-y-1.5" data-testid="vr2-blockers">
                    {day.blockersNow.map(b => <BlockerRow key={b.id} entry={b} />)}
                </div>
            )}

            <SavedScreenLower day={day} primary={primary} onDay={onDay} unclear={p.unclear} clips={p.clips} playingId={p.playingId}
                progress={p.progress} lengthOf={p.lengthOf} onTogglePlay={p.onTogglePlay} syncQueuedOf={p.syncQueuedOf} onEdit={p.onEdit}
                questionPanel={p.questionPanel} extras={p.extras} answerKit={kit} onOpenDetail={p.onOpenDetail} wordsRef={wordsRef} />

            <IdleCloseBar key={p.recordingKey} rootRef={root} pauseReason={pauseReason} overlayOpen={overlayOpen} offReason={p.autoCloseOff}
                onClose={p.onAutoClose} onAddAnother={p.onAddAnother} />
            {/* Room under the sticky bar: at the very end of the page the bar rests here, so "आजचा आढावा बघा" and the last
                rows scroll fully above it and above the app's bottom bar (seen on localhost: they sat under both). */}
            <div aria-hidden="true" data-testid="vr2-end-room" style={{ height: BOTTOM_BAR_CLEARANCE }} />
            {card && kit && <ProductCard item={card.item} logId={card.logId} kit={kit} onClose={() => setCard(null)} />}
        </div>
    );
};

export default SavedScreen;
