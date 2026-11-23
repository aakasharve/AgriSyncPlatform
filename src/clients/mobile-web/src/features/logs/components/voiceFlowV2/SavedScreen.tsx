/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 11; amendments H2, H3, H7, M4; design-fidelity pass F3) — the ONE saved screen he sees
 * first after he speaks, drawn as the approved design draws it (sathi-ring.src.html: `.hstrip`, `.spk`, `.mcard.savedc`, `.recrow`,
 * `.clip.big`, the dial, `.mnext`). Presentational: the container owns the audio, the sync read-out and the answers. Top to bottom:
 *   1. the red mix banner (the verdicts derived on read, as on the result screen); place, day (the existing move-day chip) and
 *      how many times he told it today; who told it today;
 *   2. ONE cream card: the title says only what the sync state says (P10) — "लक्षात ठेवलं ✓" while it is on this phone, the server's
 *      claim only once the server acknowledged it; who told it; the badges; his voice, big ("तुमचा आवाज ऐका"), or the typed note;
 *      the dial (the SERVER's score only, `SavedMeterGauge`, P4) and the first untold part to tell;
 *   3. for someone who does not check products, the speaker's line; "तुम्ही काय दिलं" (`SavedGiven`), the eight parts
 *      (`SavedPartsGrid`), what stopped the work;
 *   4. his words and why Sathi understood them, the question, the extras, "बदला", the earlier recordings, the detail button
 *      (`SavedScreenLower`);
 *   5. the bottom bar: the big mic and the 30-second self-close (`IdleCloseBar`), held while a clip plays, the product card or
 *      the day sheet or any overlay is open, and off when the container says so.
 * No "पक्कं आहे" here (it stays on the detail page), no projected number, no save call.
 */
import React, { useMemo, useRef, useState } from 'react';
import { FEATURE_FLAGS } from '../../../../app/featureFlags';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { openOverlayCount } from '../../../../core/navigation/backStack';
import { NotQueuedForServerBadge } from '../../../../core/navigation/mainViewComponents';
import { SHIPPABLE_RULES, type MixRule } from '../../../../domain/inputs/mixVerdict';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { BOTTOM_BAR_CLEARANCE } from '../../../../shared/utils/bottomBar';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { dayRel, dayShort } from '../dayPick/dayWords';
import type { RingNodeData } from '../shramsathi/understandingRing';
import { LegacyNote, TypedNote } from '../voiceResult/DayParts';
import { dayLinesOf, lineKeyOfVerdict } from '../voiceResult/DaySummaryLines';
import { MixBanner, tankVerdictsOf } from '../voiceResult/MixBox';
import type { ProductAnswerKit } from '../voiceResult/ProductCard';
import type { ProductItem } from '../voiceResult/productModel';
import { resultCopy } from '../voiceResult/resultCopy';
import type { DayView, PartKey, RecordingView } from '../voiceResult/resultModel';
import { resultDayStr, resultStr, useResultStr } from '../voiceResult/resultStrings';
import { scrollBelowHeader } from '../voiceResult/scrollBelowHeader';
import type { LogSyncState } from '../voiceResult/useRecordingTrust';
import IdleCloseBar from './IdleCloseBar';
import { Bd, SANS, Tick } from './savedBits';
import SavedClip from './SavedClip';
import SavedWords from './SavedWords';
import SavedGiven from './SavedGiven';
import SavedMeterGauge from './SavedMeterGauge';
import SavedPartsGrid from './SavedPartsGrid';
import SavedProductCard from './SavedProductCard';
import SavedScreenLower from './SavedScreenLower';

/** The design's `.hstrip .chip`. */
const CHIP = 'inline-block whitespace-nowrap rounded-full border border-[#DDE3DA] bg-white px-[11px] py-1 text-[13px] font-extrabold text-[#1C1917]';

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

    const severalNote = severalPlots ? null : <NotQueuedForServerBadge syncQueued={p.syncQueuedOf(primary.id)} />;
    const addedEntries = day.current.flatMap(r => r.entries);
    const speakerDone = !!kit && !kit.canCheck && addedEntries.some(e => e.products?.items.some(i => !!i.ref));

    return (
        <div ref={root} className="space-y-3 pt-1" style={{ fontFamily: SANS }} data-testid="vr2-saved">
            <MixBanner reds={reds} hint={redHint} onOpen={openRed} />
            <div className="flex flex-wrap items-center gap-1.5" data-testid="vr2-head">
                <span className={CHIP} data-testid="vr2-place"><span aria-hidden="true">📍 </span>{typeof p.placeLabel === 'function' ? p.placeLabel(language) : p.placeLabel}</span>
                {p.onChangeDay ? (
                    <button type="button" onClick={p.onChangeDay} data-testid="vr2-day" className={`${CHIP} border-[#94A3B8]`}><span aria-hidden="true">📅 </span>{dayText} ▾</button>
                ) : (
                    <span className={CHIP} data-testid="vr2-day"><span aria-hidden="true">📅 </span>{dayText}</span>
                )}
                <span className="text-[12px] font-bold text-[#5F6B63]" data-testid="vr2-count">{onDay ? (count > 1 ? nd(DS.count(count, onDay)) : DS.first(onDay)) : count > 1 ? nd(RS.todayCount(count)) : RS.firstToday}</span>
            </div>
            <div className="flex flex-wrap items-center gap-[5px] rounded-[14px] border border-[#DDE3DA] bg-white px-2.5 py-1.5" data-testid="vr2-speakers">
                <span className="text-[12px] font-extrabold text-[#5F6B63]">{onDay ? DS.who(onDay) : RS.todayWho}:</span>
                {day.speakers.map(s => (
                    <span key={`${s.you}-${s.name}`} data-you={s.you ? 'yes' : 'no'}
                        className={`rounded-full border px-[9px] py-px text-[12px] font-extrabold ${s.you ? 'border-[#86EFAC] bg-[#F0FDF4] text-[#14532D]' : 'border-[#93C5FD] bg-[#EFF6FF] text-[#1E3A8A]'}`}>
                        {s.name} · {nd(RS.times(s.times))}
                    </span>
                ))}
            </div>

            <section className="flex flex-col items-center gap-2 rounded-[22px] border-[1.5px] border-[#F0DFA6] p-3" data-testid="vr2-saved-card"
                style={{ background: 'linear-gradient(180deg,#FFFBEA,#FFF6D8)' }}>
                <div className="flex items-center gap-3 self-stretch rounded-2xl border-[1.5px] border-[#B7E4C7] bg-[#E9F8EE] px-3 py-2.5">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#1E9E5A] motion-safe:animate-plr-rise"><Tick size={24} /></span>
                    <div className="min-w-0">
                        <b className="block text-[22px] font-bold leading-[1.2] text-[#0F6B3A]" data-testid="vr2-saved-title" data-sync={p.sync}>{savedClaimOf(p.sync, RS)}</b>
                    </div>
                </div>
                {/* One quiet line instead of a badge row (founder 2026-11-23: nothing repeated — the title already says it is kept). */}
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 self-stretch text-[12.5px] font-bold text-[#5F6B63]" data-testid="vr2-badges">
                    <span data-testid="vr2-latest-who" data-you={primary.who.you ? 'yes' : 'no'}>{primary.who.name}</span>
                    {primary.timeLabel && <span aria-hidden="true">·</span>}
                    {primary.timeLabel && <span>{primary.timeLabel}</span>}
                    {primary.typed && <Bd tone="amber" testId="vr2-latest-typed">{copy.typedTag}</Bd>}
                    {p.sync === 'needsFix' && <Bd tone="amber" testId="vr2-needs-fix">{RS.needsFix}</Bd>}
                    {p.confirmed
                        ? <Bd tone="dark" testId="vr2-confirmed-badge">{RS.confirmedBadge}</Bd>
                        : <Bd testId="vr2-not-confirmed-badge">{RS.notConfirmed}</Bd>}
                </div>
                {severalNote && <div className="self-stretch empty:hidden">{severalNote}</div>}
                {primary.legacyPartial && <div className="self-stretch"><LegacyNote testId="vr2-legacy-note" /></div>}
                {FEATURE_FLAGS.understandingMeter && (
                    <SavedMeterGauge farmId={p.farmId} dayDate={primary.log.date} plotId={plotIds.length === 1 ? plotIds[0] : null} savedLogId={primary.id}
                        missing={day.missing} />
                )}
            </section>
            {speakerDone && (
                <p className="m-0 rounded-[14px] border border-[#DDE3DA] bg-white px-3 py-[9px] text-[14px] font-bold text-[#44403C]" data-testid="vr2-speaker-done">{copy.speakerDone}</p>
            )}

            {/* Founder 2026-11-23, the order: the meter (above), then his words, then the chemicals and nutrients, then the other parts. */}
            <SavedWords transcript={primary.transcript} wordsWithheld={primary.wordsWithheld} entries={day.current.flatMap(r => r.entries)} unclear={p.unclear}
                player={primary.typed ? <TypedNote /> : (
                    <div data-testid="vr2-listen">
                        <SavedClip clipKey={clip?.id ?? null} durationSec={clip ? p.lengthOf(primary.id) : null} playing={p.playingId === primary.id}
                            onToggle={() => p.onTogglePlay(primary.id)} testId="vr2-play" />
                    </div>
                )} />
            <SavedGiven day={day} kit={kit} verdicts={verdicts} onOpen={kit ? (item, logId) => setCard({ item, logId }) : () => undefined} />
            <SavedPartsGrid day={day} onTellMore={p.onTellMore} />

            <SavedScreenLower day={day} primary={primary} onDay={onDay} unclear={p.unclear} clips={p.clips} playingId={p.playingId}
                lengthOf={p.lengthOf} onTogglePlay={p.onTogglePlay} syncQueuedOf={p.syncQueuedOf} onEdit={p.onEdit}
                questionPanel={p.questionPanel} extras={p.extras} onOpenDetail={p.onOpenDetail} />

            <IdleCloseBar key={p.recordingKey} rootRef={root} pauseReason={pauseReason} overlayOpen={overlayOpen} offReason={p.autoCloseOff}
                onClose={p.onAutoClose} onAddAnother={p.onAddAnother} />
            {/* Room under the sticky bar: at the very end of the page the bar rests here, so "आजचा आढावा बघा" and the last
                rows scroll fully above it and above the app's bottom bar (seen on localhost: they sat under both). */}
            <div aria-hidden="true" data-testid="vr2-end-room" style={{ height: BOTTOM_BAR_CLEARANCE }} />
            {card && kit && <SavedProductCard item={card.item} logId={card.logId} kit={kit} onClose={() => setCard(null)} />}
        </div>
    );
};

export default SavedScreen;
