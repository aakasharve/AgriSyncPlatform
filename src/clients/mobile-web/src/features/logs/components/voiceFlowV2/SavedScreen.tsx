/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 11; amendments H2, H3, H7, M4; design-fidelity pass F3) — the ONE saved screen he sees
 * first after he speaks. Presentational: the container owns the audio, the sync read-out and the answers.
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, Stream B: B1 + B3) — drawn as the founder's FINAL design draws the result
 * (result-v12-final.html, 28 Nov). No "मागे" bar (the layer's top row is dropped while this screen is on, its back control kept for
 * the phone's back button). Top to bottom:
 *   1. the red mix banner (the verdicts derived on read, as before);
 *   2. the top card (`ResultHead`): the crop's photo (the crop page's own picture), the crop, the plot selector, the day chip when
 *      offered, and "आज कोणी सांगितलं" with each speaker's count;
 *   3. the cream meter card: the dial (the SERVER's score only, `SavedMeterGauge`, P4) and the last 7 days (`StreakDots`, from the
 *      phone's own history, drawn only once it can be trusted);
 *   4. the talk he just made (`TalkBody` in the talk card): "आत्ताचं बोलणं" and its time, the honest sync badges (P10), the 24-hour
 *      line while the SERVER's window is open, his words, his voice with "तुम्ही तुमचा आवाज ऐकलात का?" once it played to its end,
 *      "यातून काय समजलं" (products first, his own words under each value and each product, the tank water and the tank count — the
 *      parse's, else his words', else none), "बदला — पुन्हा बोला" and "हे दिसतं";
 *   5. Sathi's question slot, the extras, "आजची बोलणी" (a tap opens the whole talk, `TalkView`), the 24-hour line, and the end button
 *      "झालं — पूर्ण शेतीचा आढावा बघा" (`SavedScreenLower`);
 *   6. the bottom bar: the big mic and the self-close (`IdleCloseBar`, unchanged here), held while a clip plays, the product card, the
 *      day sheet, a talk or Sathi's "heard?" question is open (the last two are overlays on the app's back stack).
 * No "पक्कं आहे" here, no projected number, no save call.
 */
import React, { useMemo, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { FEATURE_FLAGS } from '../../../../app/featureFlags';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { openOverlayCount } from '../../../../core/navigation/backStack';
import { NotQueuedForServerBadge } from '../../../../core/navigation/mainViewComponents';
import { SHIPPABLE_RULES, type MixRule } from '../../../../domain/inputs/mixVerdict';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { BOTTOM_BAR_CLEARANCE } from '../../../../shared/utils/bottomBar';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import type { CropProfile, DailyLog } from '../../../../types';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { canMoveSavedEntry } from '../correction/correctionCapabilities';
import { dayRel, dayShort } from '../dayPick/dayWords';
import type { RingNodeData } from '../shramsathi/understandingRing';
import { dayLinesOf, lineKeyOfVerdict } from '../voiceResult/DaySummaryLines';
import { MixBanner, tankVerdictsOf, type TankVerdict } from '../voiceResult/MixBox';
import type { ProductAnswerKit } from '../voiceResult/ProductCard';
import { productBoxesOf, type ProductItem } from '../voiceResult/productModel';
import { answersOf, identityOf } from '../voiceResult/inputIdentityModel';
import { resultCopy } from '../voiceResult/resultCopy';
import type { DayView, PartKey, RecordingView } from '../voiceResult/resultModel';
import { resultDayStr, resultStr, useResultStr, type ResultStr } from '../voiceResult/resultStrings';
import { scrollBelowHeader } from '../voiceResult/scrollBelowHeader';
import type { LogSyncState } from '../voiceResult/useRecordingTrust';
import { talkWindowFor } from './editWindow';
import { correctionWords } from '../correction/correctionWords';
import { finalResultWords } from './finalResultWords';
import IdleCloseBar from './IdleCloseBar';
import ResultHead from './ResultHead';
import { Bd, LineGlyph, SANS } from './savedBits';
import { savedWords } from './savedCopy';
import SavedMeterGauge from './SavedMeterGauge';
import SavedProductCard from './SavedProductCard';
import ProductFlashCard from './ProductFlashCard';
import { tankWordsOf } from './SavedGiven';
import type { OpenProduct, RowRect } from './SavedProducts';
import SavedScreenLower from './SavedScreenLower';
import StreakDots from './StreakDots';
import { useStreakWeek } from './streakWeek';
import { logsOfTalk, partsOfTalk, talkDayOf } from './talkDay';
import type { TalkRow } from './TalkList';
import { TalkBody, TalkView } from './TalkView';
import { HeardSheet } from './TalkVoice';
import { useHideVoiceLayerTop, useVoiceLayerBottom } from './VoiceLayer';

/** The design's `.hstrip .chip` (the day chip). */
const CHIP = 'inline-flex items-center whitespace-nowrap rounded-full border border-[#DDE3DA] bg-white px-[11px] py-1 text-[13px] font-extrabold text-[#1C1917]';
/** The talk card's pills (`.lc .pills span`). */
const PILL = 'rounded-full bg-[#065F46] px-[11px] py-[3px] text-[12.5px] font-extrabold text-white';
/** "बदला — पुन्हा बोला" (`.rerec`). */
const REDO = 'flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-[#E7E5E4] bg-white px-3.5 text-[16px] font-extrabold text-[#292524] active:scale-[0.99]';

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
    /** "ही नोंद कोण पाहू शकतो" (the holder's row): drawn at the end of the talk card, under "बदला". */
    audience?: React.ReactNode;
    answerKit?: ProductAnswerKit;
    mixRules?: readonly MixRule[];
    /** Repair R1-g 1b — the FIRST record's setup-hub offer, drawn right under the meter card; absent = not offered. */
    firstRecordOffer?: React.ReactNode;
    /** Why this screen must NOT close itself (the container's honesty rules); null = it closes after 30 s untouched. */
    autoCloseOff: string | null;
    /** Today's detail page. The final design has no button for it; a wrong mix the screen cannot show is opened there. */
    onOpenDetail: () => void;
    onAutoClose: () => void;
    /** The phone's log history: the meter card's last 7 days. Absent = the days are not drawn. */
    history?: readonly DailyLog[];
    /** The farm's crops (the top card's photo). */
    crops?: readonly CropProfile[];
    /** The clips that played to their END on this screen (the container's playback): Sathi then asks once whether he heard it. */
    heard?: ReadonlySet<string>;
    /** "झालं — पूर्ण शेतीचा आढावा बघा". Absent = the screen's close handler (`onAutoClose`). */
    onFinish?: () => void;
    /** The signed-in user (the 24-hour window binds only a talk's own speaker). Absent = no window is shown or applied. */
    viewerUserId?: string | null;
    /** He is the farm's primary owner (the closed-window line then does not point him to the owner). */
    viewerIsOwner?: boolean;
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

/** The plots one log of this recording is about, as named on the farm (the result screen's own rule). */
const plotsOf = (r: RecordingView, RS: ResultStr): string => {
    const names = (r.log.context?.selection ?? []).flatMap(s => s.selectedPlotNames ?? []).filter(Boolean);
    return names.length > 0 ? names.join(', ') : RS.wholeFarm;
};

const addTo = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => new Set([...set, id]);

export const SavedScreen: React.FC<SavedScreenProps> = (p) => {
    const { day } = p;
    const primary: RecordingView | undefined = day.current.find(r => !!r.transcript) ?? day.current[0];
    const [card, setCard] = useState<{ item: ProductItem; logId: string; from?: RowRect } | null>(null);
    const [openTalk, setOpenTalk] = useState<string | null>(null);
    // Sathi's "heard?" question: asked once per clip that played to its end; "हो, ऐकला" marks the clip.
    const [heardYes, setHeardYes] = useState<ReadonlySet<string>>(() => new Set());
    const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set());
    const root = useRef<HTMLDivElement>(null);
    // The final design has no "मागे" bar: the layer's top row goes while this screen draws its own top card.
    useHideVoiceLayerTop(!!primary);
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
    const inLayer = useVoiceLayerBottom() !== undefined;
    const streak = useStreakWeek(p.history, p.farmId);
    if (!primary) return null;
    const copy = resultCopy(language);
    const DS = resultDayStr(language);
    const FW = finalResultWords(language);
    const SW = savedWords(language);
    const CW = correctionWords(language);
    const nd = (text: string): string => digitsFor(text, language);
    const onDay = primary.log.date && primary.log.date !== getDateKey() ? nd(dayShort(primary.log.date, language)) : null;
    const severalPlots = day.current.length > 1;
    const placeText = typeof p.placeLabel === 'function' ? p.placeLabel(language) : p.placeLabel;
    const nowLines = dayLinesOf(day, language, 'now');

    // The talk he just made, read as one talk; its logs as this phone holds them.
    const logById = (id: string): DailyLog | undefined => kit?.logById.get(id) ?? [...day.current, ...day.earlier].find(r => r.log.id === id)?.log;
    const verdictsOf = (logs: readonly DailyLog[]): TankVerdict[] => { const ids = new Set(logs.map(l => l.id)); return verdicts.filter(v => ids.has(v.logId)); };
    const nowLogs = logsOfTalk(day.current, logById);
    const nowTalk = talkDayOf(day.current, nowLogs, day.missing);
    // Part 03 B5: the SERVER's window, for this viewer only — the line while it is open for the talk's own speaker; once it
    // passed, HIS edit doors on this talk close (the server would refuse them). Nobody else's doors, and never an answer or a check.
    const nowWindow = talkWindowFor(nowLogs, p.viewerUserId);
    const editableNow = nowWindow === 'open';
    const closedNow = nowWindow === 'closed';
    const openProduct: OpenProduct = kit ? (item, logId, from) => setCard({ item, logId, from }) : () => undefined;

    const redHint = (() => {
        const v = reds[0];
        const lines = dayLinesOf(day, language);
        const box = v ? lines.find(l => l.key === lineKeyOfVerdict(lines, v))?.box : undefined;
        const kind = box ? (box.kind === 'spray' ? copy.spray : box.kind === 'drip' ? copy.drip : copy.products) : '';
        return [kind, copy.mixBannerHint].filter(Boolean).join(' · ');
    })();
    // The banner brings this talk's tank into view; a wrong mix of an earlier talk opens THAT talk (its tank and box are in it).
    const openRed = (v: (typeof reds)[number]) => {
        const key = nowLines.find(l => l.key === `inputs:${v.hostEventId}`)?.key;
        const el = key ? root.current?.querySelector<HTMLElement>(`[data-testid="vr2-given-${key}"]`) : null;
        if (el) { scrollBelowHeader(el); return; }
        const earlier = day.earlier.find(r => r.logIds.includes(v.logId));
        if (earlier) setOpenTalk(earlier.id); else p.onOpenDetail();
    };
    const pauseReason = p.playingId ? 'clip' : card ? 'product' : p.pickingDay ? 'day' : null;
    const dayText = nd(dayRel(primary.log.date, getDateKey(), language));
    const dayChip = p.onChangeDay && !closedNow ? (
        <button type="button" onClick={p.onChangeDay} data-testid="vr2-day" className={`${CHIP} border-[#94A3B8]`}><CalendarDays size={14} className="mr-1 text-[#0F6B3A]" aria-hidden="true" />{dayText} ▾</button>
    ) : onDay ? (
        <span className={CHIP} data-testid="vr2-day"><CalendarDays size={14} className="mr-1 text-[#0F6B3A]" aria-hidden="true" />{dayText}</span>
    ) : null;

    const severalNote = severalPlots ? null : <NotQueuedForServerBadge syncQueued={p.syncQueuedOf(primary.id)} />;
    const addedEntries = day.current.flatMap(r => r.entries);
    const speakerDone = !!kit && !kit.canCheck && addedEntries.some(e => e.products?.items.some(i => !!i.ref));
    const showMeter = FEATURE_FLAGS.understandingMeter === true;
    const plotIds = [...new Set((primary.log.context?.selection ?? []).flatMap(s => s.selectedPlotIds ?? []).filter(Boolean))];

    // "आजची बोलणी": the talk he just made, then the day's earlier talks (newest first) — only what is on this phone.
    const lengthIf = (r: RecordingView): number | null => (!r.typed && p.clips.get(r.id) ? p.lengthOf(r.id) : null);
    const talks: TalkRow[] = [
        { rec: primary, now: true, parts: partsOfTalk(day.current), blocker: day.blockersNow.length > 0, lengthSec: lengthIf(primary) },
        ...day.earlier.map(r => ({ rec: r, now: false, parts: partsOfTalk([r]), blocker: r.blockers.length > 0, lengthSec: lengthIf(r) })),
    ];
    const opened = openTalk === primary.id
        ? { recs: day.current, rec: primary, now: true }
        : (() => { const r = day.earlier.find(x => x.id === openTalk); return r ? { recs: [r], rec: r, now: false } : null; })();
    const openedLogs = opened ? (opened.now ? nowLogs : logsOfTalk(opened.recs, logById)) : [];
    const asking = p.heard ? [...p.heard].map(id => (id === primary.id ? primary : day.earlier.find(r => r.id === id))).find(r => !!r && !asked.has(r.id)) : undefined;
    const answerHeard = (id: string, yes: boolean) => { setAsked(s => addTo(s, id)); if (yes) setHeardYes(s => addTo(s, id)); };

    return (
        <div ref={root} className="space-y-3 pt-2" style={{ fontFamily: SANS }} data-testid="vr2-saved">
            <MixBanner reds={reds} hint={redHint} onOpen={openRed} />
            <ResultHead logs={nowLogs} crops={p.crops} placeLabel={placeText} speakers={day.speakers} whoLabel={onDay ? DS.who(onDay) : RS.todayWho}
                onChangePlot={!severalPlots && !closedNow && canMoveSavedEntry() ? () => p.onEdit(primary.id) : undefined} dayChip={dayChip} />

            {(showMeter || streak) && (
                <section className="flex flex-col items-center gap-1.5 rounded-[22px] border-[1.5px] border-[#F0DFA6] p-3" data-testid="vr2-saved-card"
                    style={{ background: 'linear-gradient(180deg,#FFFBEA,#FFF6D8)' }}>
                    {showMeter && (
                        <SavedMeterGauge farmId={p.farmId} dayDate={primary.log.date} plotId={plotIds.length === 1 ? plotIds[0] : null} savedLogId={primary.id}
                            missing={day.missing} />
                    )}
                    <StreakDots days={streak} />
                </section>
            )}
            {p.firstRecordOffer}
            {speakerDone && (
                <p className="m-0 rounded-[14px] border border-[#DDE3DA] bg-white px-3 py-[9px] text-[14px] font-bold text-[#44403C]" data-testid="vr2-speaker-done">{copy.speakerDone}</p>
            )}

            <section className="flex flex-col gap-2.5 rounded-2xl border-2 border-[#059669] bg-white p-3.5" data-testid="vr2-talk">
                <div className="flex flex-wrap items-center gap-1.5" data-testid="vr2-badges">
                    <span className={PILL}>{FW.nowTalk}</span>
                    {primary.timeLabel && <span className={PILL} data-testid="vr2-talk-time">{primary.timeLabel}</span>}
                    {primary.typed && <Bd tone="amber" testId="vr2-latest-typed">{copy.typedTag}</Bd>}
                    {/* P10: the phone's claim always, the server's only once it acknowledged the talk. */}
                    <Bd tone="green" testId="vr2-claim-phone">{RS.remembered}</Bd>
                    {p.sync === 'onServer' && <Bd tone="blue" testId="vr2-claim-server">{RS.onServer}</Bd>}
                    {p.sync === 'needsFix' && <Bd tone="amber" testId="vr2-needs-fix">{RS.needsFix}</Bd>}
                    {p.confirmed
                        ? <Bd tone="dark" testId="vr2-confirmed-badge">{RS.confirmedBadge}</Bd>
                        : <Bd testId="vr2-not-confirmed-badge">{RS.notConfirmed}</Bd>}
                </div>
                {severalNote && <div className="empty:hidden">{severalNote}</div>}
                <TalkBody recs={day.current} primary={primary} talk={nowTalk} editable={editableNow} wordsTitle={FW.yourWords} unclear={p.unclear}
                    clip={p.clips.get(primary.id)} durationSec={p.lengthOf(primary.id)} playing={p.playingId === primary.id}
                    onTogglePlay={() => p.onTogglePlay(primary.id)} heard={heardYes.has(primary.id)} kit={kit} verdicts={verdictsOf(nowLogs)}
                    onOpenProduct={openProduct} onTellMore={p.onTellMore} idPrefix="vr2" />
                {closedNow ? (
                    <p className="m-0 flex items-start gap-2 rounded-2xl border border-[#E7E5E4] bg-[#FAFAF9] p-3 text-[15px] font-bold leading-snug text-[#44403C]" data-testid="vr2-edit-closed">
                        <LineGlyph name="pen" size={16} className="mt-0.5 flex-none" />{p.viewerIsOwner ? CW.windowClosedOwner : CW.windowClosed}
                    </p>
                ) : severalPlots ? (
                    // He named several plots: one log each. Each can be fixed, and each says if it will not reach the server.
                    <div className="flex flex-col gap-1.5" data-testid="vr2-plots">
                        <div className="text-[13px] font-extrabold text-[#5F6B63]">{SW.plotsEach(digitsFor(day.current.length, language))}</div>
                        {day.current.map(r => (
                            <div key={r.id} data-testid={`vr2-plot-${r.id}`}>
                                <button type="button" onClick={() => p.onEdit(r.id)} data-testid={`vr2-edit-${r.id}`} className={`${REDO} justify-start text-left`}>
                                    <LineGlyph name="pen" size={16} className="flex-none" /><span className="truncate">{FW.redo} · {plotsOf(r, RS)}</span>
                                </button>
                                <NotQueuedForServerBadge syncQueued={p.syncQueuedOf(r.id)} />
                            </div>
                        ))}
                    </div>
                ) : (
                    <button type="button" onClick={() => p.onEdit(primary.id)} data-testid="vr2-edit" className={REDO}>
                        <LineGlyph name="pen" size={16} className="flex-none" />{FW.redo}
                    </button>
                )}
                {p.audience}
            </section>

            <SavedScreenLower onDay={onDay} questionPanel={p.questionPanel} extras={p.extras} talks={talks} onOpenTalk={setOpenTalk}
                editable={editableNow} onFinish={p.onFinish ?? p.onAutoClose} />

            <IdleCloseBar key={p.recordingKey} rootRef={root} pauseReason={pauseReason} overlayOpen={overlayOpen} offReason={p.autoCloseOff}
                onClose={p.onAutoClose} onAddAnother={p.onAddAnother} />
            {/* Room under the sticky bar: at the very end of the page the bar rests here, so the end button and the last rows scroll
                fully above it and above the app's bottom bar. */}
            <div aria-hidden="true" data-testid="vr2-end-room" style={{ height: inLayer ? 8 : BOTTOM_BAR_CLEARANCE }} />
            {opened && (
                <TalkView recs={opened.recs} primary={opened.rec} now={opened.now} talk={opened.now ? nowTalk : talkDayOf(opened.recs, openedLogs)}
                    editable={talkWindowFor(openedLogs, p.viewerUserId) === 'open'} unclear={opened.now ? p.unclear : []} clip={p.clips.get(opened.rec.id)}
                    durationSec={p.lengthOf(opened.rec.id)} playing={p.playingId === opened.rec.id} onTogglePlay={() => p.onTogglePlay(opened.rec.id)}
                    heard={heardYes.has(opened.rec.id)} kit={kit} verdicts={verdictsOf(openedLogs)} onOpenProduct={openProduct}
                    onClose={() => setOpenTalk(null)} />
            )}
            {card && kit && (() => {
                // Part 03 B2: a library product opens the flash card, grown out of its row; a product the library does not know keeps the
                // existing bottom card (its photo and "did you mean" names).
                const log = kit.logById.get(card.logId);
                const close = () => setCard(null);
                if (identityOf(card.item, answersOf(log, card.item.ref)).state !== 'found') return <SavedProductCard item={card.item} logId={card.logId} kit={kit} onClose={close} />;
                const box = log ? productBoxesOf(log).find(b => b.items.some(i => i.id === card.item.id)) : undefined;
                const rec = [...day.current, ...day.earlier].find(r => r.logIds.includes(card.logId));
                const now = !!rec && day.current.includes(rec);
                const talk = now ? nowTalk : rec ? talkDayOf([rec], logsOfTalk([rec], logById)) : undefined;
                return (
                    <ProductFlashCard item={card.item} logId={card.logId} kit={kit} box={box} words={box ? tankWordsOf(day, kit, card.logId, box) : undefined}
                        talk={talk} speaker={(now ? primary : rec)?.who} from={card.from} onClose={close} />
                );
            })()}
            {asking && (
                <HeardSheet mine={asking.who.you} onYes={() => answerHeard(asking.id, true)} onClose={() => answerHeard(asking.id, false)}
                    onAgain={() => { answerHeard(asking.id, false); p.onTogglePlay(asking.id); }} />
            )}
        </div>
    );
};

export default SavedScreen;
