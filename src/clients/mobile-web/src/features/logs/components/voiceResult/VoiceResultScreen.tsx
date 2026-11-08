/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — the ONE screen after he speaks.
 *
 * Founder PLR-D1 (rounds 1-5) and PLR-D5, ported from the approved preview (postVoiceResult/PostVoiceResult.tsx)
 * onto REAL data. Presentational: the container (`VoiceResultContainer`) owns the audio, the confirm and the
 * sync read-out. Top to bottom:
 *   0. the meter + all eight parts, the unmentioned ones in red, each tappable to tell Sathi (ResultHero);
 *   1. the recording he JUST made: "लक्षात ठेवलं" (true: the screen exists only after the phone's durable
 *      write) and the server state honestly; his words colour-marked; a big play button; "यातून काय समजलं";
 *      Sathi's ONE question (the existing panel, flag-gated); for the PRIMARY OWNER only, "पक्कं आहे" — his "save and
 *      confirm" (spec I27, founder D-44 / D-46: the speaker is never asked to confirm, and listening is never forced);
 *      everyone else sees his recording stay "पक्कं नाही" until the owner (or whoever the owner trusts) confirms it;
 *      "बदला" (the existing edit form) — one per plot, each with its own not-queued badge, when he named several;
 *   2. the plot's whole day, one row per part; 3. the day's earlier recordings, newest first;
 *   4. the bottom bar: "मागे" + "आणखी सांगा".
 * One screen for readers and non-readers alike (no mode switch).
 *
 * Lane IT4 (spec dfes-input-truth-and-mix-check-2026-11-06; founder 2026-11-06) - the simple form: a red banner on top when a combination
 * is wrong; the day as ONE tappable line per part, nothing expanded (`DaySummaryLines`); a spray or drip line opens to one big coloured
 * row per product (Option 3) whose card carries the library's facts and हो / नाही / फोटो; his words folded under one line with his
 * play button; real names for who said it. The speaker's answer is optional and kept as his (D-95). The record is only read here (P7).
 *
 * Lane L6b (founder design, `PostVoiceResultPreview.sendTyped` / `TypedLog.tsx`): what he TYPED to Sathi lands on this
 * same screen, marked "लिहिलेलं", with the design's no-recording note where the player would be (no player, no "ऐका");
 * the why-tiles are the design's ("श्रम साथीला हे का समजले?"); sprays and fertilisers sit on one chip row; Sathi's
 * question is the design's amber card (the container's panel, `look="sathi"`).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, MapPin, Mic, Pencil } from 'lucide-react';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { dayRel, dayShort } from '../dayPick/dayWords';
import FlowBackButton from '../../../context/components/FlowBackButton';
import { NotQueuedForServerBadge } from '../../../../core/navigation/mainViewComponents';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import type { RingNodeData } from '../shramsathi/understandingRing';
import ClipPlayer from './ClipPlayer';
import { BlockerRow, EarlierRecording, LegacyNote, TimePill, TypedNote, TypedTag, WhoChip } from './DayParts';
import DaySummaryLines, { dayLinesOf, lineKeyOfVerdict } from './DaySummaryLines';
import { PartLinks, Words, WordsFold } from './HisWords';
import { MixBanner, tankVerdictsOf } from './MixBox';
import ProductCard, { type ProductAnswerKit } from './ProductCard';
import type { ProductItem } from './productModel';
import { resultCopy } from './resultCopy';
import type { MixRule } from '../../../../domain/inputs/mixVerdict';
import { SHIPPABLE_RULES } from '../../../../domain/inputs/mixVerdict';
import ResultHero from './ResultHero';
import { markTranscript, type DayView, type PartKey, type RecordingView } from './resultModel';
import { resultDayStr, useResultStr, type ResultStr } from './resultStrings';
import { scrollBelowHeader } from './scrollBelowHeader';
import type { LogSyncState } from './useRecordingTrust';
import MoneyWordsWithheldCard from '../originalVoice/MoneyWordsWithheldCard';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface VoiceResultScreenProps {
    day: DayView;
    recordingKey: string;
    /** The plot(s) this recording is about, as named on the farm. */
    /** Where: a fixed label, or one built in the app's language (spec I18: crop names follow the language). */
    placeLabel: string | ((language: string | undefined) => string);
    farmId: string | null;
    nodes: RingNodeData[];
    /** Phrases the parse could not place, shown as he said them. */
    unclear: readonly string[];
    /** Clips on this phone, by log id (this recording's and the earlier ones'). */
    clips: ReadonlyMap<string, VoiceClipCacheRecord>;
    /** This phone has been asked for the clips: until then "no clip" is unknown. (I27: the owner's confirm no longer waits on it.) */
    clipsReady: boolean;
    playingId: string | null;
    progress: number;
    lengthOf: (logId: string) => number | null;
    heard: ReadonlySet<string>;
    onTogglePlay: (logId: string) => void;
    sync: LogSyncState;
    /** Per log, from the save's enqueue result: false = it will not reach the server (honest badge); null = no claim. */
    syncQueuedOf: (logId: string) => boolean | null | undefined;
    /**
     * Spec I27 (founder D-44 / D-46): ONLY the primary owner confirms his own recording here ("save and confirm"); a
     * speaker who is not the primary owner is never asked. Also needs a server identity and at least one of this
     * recording's logs on its way to the server (P5).
     */
    canConfirm: boolean;
    /** He confirmed this recording (in this session, or the log already says so). */
    confirmed: boolean;
    confirmFailed: boolean;
    onConfirm: () => void;
    /** Opens the existing edit form for that log of this recording. */
    onEdit: (logId: string) => void;
    onBack: () => void;
    onAddAnother: () => void;
    onTellMore: (part: PartKey) => void;
    /** Sathi's ONE question (LedgerRecognitionPanel), mounted by the container. */
    questionPanel?: React.ReactNode;
    /** The other existing post-save surfaces the container keeps (clarity line, task close). */
    extras?: React.ReactNode;
    /**
     * Lane OF (rule TAP-1, item 6) — the day chip opens the calendar to put this SAVED recording on another day. Only
     * once the server can move a saved entry (`correctionCapabilities.canMoveSavedEntry`, lane OF-S); until then the day
     * is shown and not offered as a button (P5).
     */
    onChangeDay?: () => void;
    /**
     * Lane IT4 (spec dfes-input-truth-and-mix-check-2026-11-06) - what the product rows need to answer with (the records, the
     * roles, the queue, the camera). Absent = the rows are shown with no answers and no combination check.
     */
    answerKit?: ProductAnswerKit;
    /** Lane IT4 - the mixing rules the combination boxes use. Default: the shippable list, which holds no red rule until a person has reviewed one (D-96). Test seam. */
    mixRules?: readonly MixRule[];
}

/** The plots one log of this recording is about, as named on the farm (his own words for them). */
/** Lane IT4 Task 0b - the ONE plot a log is about, for the plot's own score; none for a whole-farm log or one that names several. */
const plotIdOf = (r: RecordingView): string | null => {
    const ids = [...new Set((r.log.context?.selection ?? []).flatMap(s => s.selectedPlotIds ?? []).filter(Boolean))];
    return ids.length === 1 ? ids[0] : null;
};

const plotsOf = (r: RecordingView, RS: ResultStr): string => {
    const names = (r.log.context?.selection ?? []).flatMap(s => s.selectedPlotNames ?? []).filter(Boolean);
    return names.length > 0 ? names.join(', ') : RS.wholeFarm;
};

export const VoiceResultScreen: React.FC<VoiceResultScreenProps> = (p) => {
    const { day } = p;
    const primary: RecordingView | undefined = day.current.find(r => !!r.transcript) ?? day.current[0];
    const [focus, setFocus] = useState<PartKey | null>(null);
    const [openLines, setOpenLines] = useState<ReadonlySet<string>>(() => new Set());
    const [wordsOpen, setWordsOpen] = useState(false);
    const [card, setCard] = useState<{ item: ProductItem; logId: string } | null>(null);
    const [scrollTo, setScrollTo] = useState<string | null>(null);
    const latest = useRef<HTMLElement>(null);
    const rules = p.mixRules ?? SHIPPABLE_RULES;
    const kit = p.answerKit;
    // Lane IT4 Task 3 - the day's tank verdicts, derived on read from the records on this screen; nothing is stored.
    const verdicts = useMemo(() => {
        if (!kit) return [];
        const ids = [...new Set([...p.day.current, ...p.day.earlier].flatMap(r => r.logIds))];
        return ids.flatMap(id => tankVerdictsOf(kit.logById.get(id), rules));
    }, [kit, p.day, rules]);
    const reds = useMemo(() => verdicts.filter(v => v.result.state === 'red'), [verdicts]);
    // After the banner opens a line, bring it into view below the sticky header.
    useEffect(() => {
        if (!scrollTo) return;
        const el = latest.current?.querySelector<HTMLElement>(`[data-testid="vr-line-${scrollTo}"]`);
        scrollBelowHeader(el);
        setScrollTo(null);
    }, [scrollTo]);
    const language = useOptionalLanguage()?.language;
    const RS = useResultStr();
    if (!primary) return null;
    // Lane OF fix 1 (L2): a recording saved for a PAST day (D-60) names that day — never "आज".
    const DS = resultDayStr(language);
    const onDay = primary.log.date && primary.log.date !== getDateKey() ? dayShort(primary.log.date, language) : null;

    const addedEntries = day.current.flatMap(r => r.entries);
    const runs = markTranscript(primary.transcript, addedEntries);
    const copy = resultCopy(language);
    const plotId = plotIdOf(primary);
    const lines = dayLinesOf(day, language);
    const toggleLine = (key: string) => setOpenLines(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    // Banner: one tap opens the line that holds the wrong mix and brings it into view.
    const openRed = (v: (typeof reds)[number]) => {
        const key = lineKeyOfVerdict(lines, v);
        if (!key) return;
        setOpenLines(prev => new Set(prev).add(key));
        setScrollTo(key);
    };
    const redHint = (() => {
        const v = reds[0];
        const box = v ? lines.find(l => l.key === lineKeyOfVerdict(lines, v))?.box : undefined;
        const kind = box ? (box.kind === 'spray' ? copy.spray : box.kind === 'drip' ? copy.drip : copy.products) : '';
        return [kind, copy.mixBannerHint].filter(Boolean).join(' · ');
    })();
    // D-95: someone who does not check sees that the owner will, once, under the badges - only when there is a product to check.
    const hasAnswerable = !!kit && addedEntries.some(e => e.products?.items.some(i => !!i.ref));
    const clip = p.clips.get(primary.id);
    const heard = p.heard.has(primary.id);
    // Founder D-44 (amends PLR-D1 round 2): listening is never a compulsory step. He may confirm from his words
    // ("वाचा आणि पक्कं करा", recorded as read-not-heard) or after playing his clip ("ऐका आणि पक्कं करा", heard).
    // How many times he told Sathi today: one recording, however many plots it named, counted once (the earlier ones
    // are already one row each); an entry filled in on the form is not a time he "said" it (L6b: one TYPED to Sathi is —
    // the sheet's own words are "लिहून सांगा", and the design counts it).
    const count = day.earlier.filter(r => !r.byForm).length + 1;
    const severalPlots = day.current.length > 1;
    // Lands his words below the sticky back bar, never under it (the preview's scrollBelowHeader).
    const toWords = () => scrollBelowHeader(latest.current);

    return (
        <div className="space-y-3 pb-6 pt-1" style={{ fontFamily: SANS }} data-testid="voice-result">
            <MixBanner reds={reds} hint={redHint} onOpen={openRed} />
            <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-sm font-extrabold text-stone-800" data-testid="vr-place"><MapPin size={16} aria-hidden="true" />{typeof p.placeLabel === 'function' ? p.placeLabel(language) : p.placeLabel}</span>
                {p.onChangeDay ? (
                    <button type="button" onClick={p.onChangeDay} data-testid="vr-day" className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-extrabold text-stone-800"><CalendarDays size={16} aria-hidden="true" />{dayRel(primary.log.date, getDateKey(), language)}</button>
                ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm font-extrabold text-stone-700" data-testid="vr-day"><CalendarDays size={16} aria-hidden="true" />{dayRel(primary.log.date, getDateKey(), language)}</span>
                )}
                <span className="text-xs font-bold text-stone-600" data-testid="vr-count">{onDay ? (count > 1 ? DS.count(count, onDay) : DS.first(onDay)) : count > 1 ? RS.todayCount(count) : RS.firstToday}</span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-stone-200 bg-white px-2.5 py-1.5" data-testid="vr-speakers">
                <span className="text-[12px] font-extrabold text-stone-700">{onDay ? DS.who(onDay) : RS.todayWho}:</span>
                {day.speakers.map(s => (
                    <span key={`${s.you}-${s.name}`} data-you={s.you ? 'yes' : 'no'}
                        className={`rounded-full border px-2 py-0.5 text-[12px] font-extrabold ${s.you ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-blue-300 bg-blue-50 text-blue-900'}`}>
                        {s.name} · {RS.times(s.times)}
                    </span>
                ))}
            </div>

            <ResultHero farmId={p.farmId} dayDate={primary.log.date} plotId={plotId} savedLogId={primary.id} recordingKey={p.recordingKey}
                nodes={p.nodes} missing={day.missing} unsure={day.unsure} onTellMore={p.onTellMore} onReadMore={toWords} typed={primary.typed} />

            <section ref={latest} className="rounded-3xl border-2 border-emerald-600 bg-white p-3.5" data-testid="vr-latest">
                <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px] font-extrabold">
                    <span className="rounded-full bg-emerald-700 px-2.5 py-1 text-white">{RS.justNow}</span>
                    <TimePill label={primary.timeLabel} strong />
                    <WhoChip who={primary.who} testId="vr-latest-who" />
                    {primary.typed && <TypedTag testId="vr-latest-typed" />}
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800" data-testid="vr-remembered">{RS.remembered}</span>
                    {p.sync === 'onServer' && <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-800" data-testid="vr-on-server">{RS.onServer}</span>}
                    {p.sync === 'needsFix' && <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-amber-800" data-testid="vr-needs-fix">{RS.needsFix}</span>}
                    {p.confirmed
                        ? <span className="rounded-full bg-emerald-900 px-2.5 py-1 text-white" data-testid="vr-confirmed-badge">{RS.confirmedBadge}</span>
                        : <span className="rounded-full border border-stone-300 bg-stone-50 px-2.5 py-1 text-stone-700" data-testid="vr-not-confirmed-badge">{RS.notConfirmed}</span>}
                </div>
                {!severalPlots && <NotQueuedForServerBadge syncQueued={p.syncQueuedOf(primary.id)} />}
                {primary.legacyPartial && <LegacyNote />}
                {kit && !kit.canCheck && hasAnswerable && (
                    <p className="m-0 mt-2 text-[14px] font-bold leading-snug text-stone-700" data-testid="vr-speaker-done">{copy.speakerDone}</p>
                )}

                {/* The day as ONE tappable line per part, nothing expanded (lane IT4 Task 1). */}
                <div className="mt-3" data-testid="vr-day-lines">
                    <h3 className="m-0 text-sm font-extrabold text-stone-700" data-testid="vr-day-title">{onDay ? DS.title(onDay) : RS.dayTitle}</h3>
                    <p className="m-0 mb-1 text-[12px] text-stone-600">{RS.tapForHistory}</p>
                    <DaySummaryLines day={day} open={openLines} onToggle={toggleLine} verdicts={verdicts} kit={kit}
                        onOpenProduct={kit ? (item, logId) => setCard({ item, logId }) : undefined} />
                    {day.blockersNow.length > 0 && (
                        <div className="mt-2 space-y-1.5" data-testid="vr-blockers">
                            {day.blockersNow.map(b => <BlockerRow key={b.id} entry={b} />)}
                        </div>
                    )}
                </div>

                {/* His words, folded under ONE line with his recording's play button (lane IT4 Task 1). */}
                <WordsFold open={wordsOpen} onToggle={() => setWordsOpen(o => !o)}
                    player={primary.typed ? <TypedNote /> : clip ? (
                        <ClipPlayer clipKey={clip.id} durationSec={p.lengthOf(primary.id)} playing={p.playingId === primary.id} progress={p.progress} big
                            onToggle={() => p.onTogglePlay(primary.id)} testId="vr-play" />
                    ) : undefined}>
                    {primary.wordsWithheld
                        ? <MoneyWordsWithheldCard testId="vr-words-withheld" />
                        : runs.length > 0 && <Words runs={runs} tags focus={focus} />}
                    <PartLinks runs={runs} entries={addedEntries} focus={focus} onFocus={setFocus} />

                    {p.unclear.length > 0 && (
                        <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 p-2.5" data-testid="vr-unclear">
                            <div className="mb-1 text-[12.5px] font-extrabold text-amber-900">{RS.unclearTitle}</div>
                            {p.unclear.map((u, i) => <div key={i} className="text-[15px] font-semibold text-stone-800">“{u}”</div>)}
                        </div>
                    )}
                </WordsFold>

                {p.questionPanel && <div className="mt-3">{p.questionPanel}</div>}

                {p.canConfirm && (p.confirmed ? (
                    <div className="mt-3 rounded-2xl border-2 border-emerald-900 bg-emerald-50 p-3 text-center font-extrabold text-emerald-900" data-testid="vr-confirm-done">
                        <Check className="mx-auto mb-0.5" size={22} aria-hidden="true" /> {RS.confirmedDone}
                        <div className="mt-0.5 text-[13px] font-bold text-emerald-800" data-testid="vr-kept-safe">{RS.keptSafe}</div>
                    </div>
                ) : (
                    <div className="mt-3">
                        <div className="mb-1.5 text-base font-extrabold" data-testid="vr-confirm-basis">{heard ? RS.listenAndConfirm : RS.readAndConfirm}</div>
                        <button type="button" onClick={p.onConfirm} data-testid="vr-confirm"
                            className="min-h-[62px] w-full rounded-2xl bg-emerald-700 text-xl font-extrabold text-white">
                            {`✔ ${RS.confirm}`}
                        </button>
                        {p.confirmFailed && <p className="m-0 mt-1 text-[13px] font-bold text-red-700" data-testid="vr-confirm-failed">{RS.confirmFailed}</p>}
                    </div>
                ))}

                {severalPlots ? (
                    // He named several plots: one log each. Each can be fixed, and each says if it will not reach the server.
                    <div className="mt-2 space-y-1.5" data-testid="vr-plots">
                        {day.current.map(r => (
                            <div key={r.id} data-testid={`vr-plot-${r.id}`} className="rounded-2xl border border-stone-200 bg-white p-1.5">
                                <button type="button" onClick={() => p.onEdit(r.id)} data-testid={`vr-edit-${r.id}`}
                                    className="flex min-h-[48px] w-full items-center gap-2 rounded-xl px-2 text-left text-base font-extrabold text-stone-700">
                                    <Pencil size={18} aria-hidden="true" />
                                    <span className="min-w-0 flex-1 truncate">{RS.edit} · {plotsOf(r, RS)}</span>
                                </button>
                                <NotQueuedForServerBadge syncQueued={p.syncQueuedOf(r.id)} />
                            </div>
                        ))}
                    </div>
                ) : (
                    <button type="button" onClick={() => p.onEdit(primary.id)} data-testid="vr-edit"
                        className="mt-2 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-stone-300 bg-white text-base font-extrabold text-stone-700">
                        <Pencil size={18} aria-hidden="true" /> {RS.edit}
                    </button>
                )}
            </section>

            {p.extras}

            {day.earlier.length > 0 && (
                <div className="space-y-2" data-testid="vr-earlier">
                    <h3 className="m-0 pt-1 text-sm font-extrabold text-stone-700">{onDay ? DS.earlier : RS.earlierTitle}</h3>
                    {day.earlier.map(r => (
                        <EarlierRecording key={r.id} rec={r} clip={p.clips.get(r.id)} playing={p.playingId === r.id} progress={p.progress}
                            lengthSec={p.lengthOf(r.id)} onToggle={() => p.onTogglePlay(r.id)} />
                    ))}
                </div>
            )}
            <p className="px-1.5 text-center text-xs leading-relaxed text-stone-600">{RS.foot}</p>

            <div className="flex items-center gap-2 pt-1" data-testid="vr-actionbar">
                <FlowBackButton onClick={p.onBack} testId="vr-back" />
                <button type="button" onClick={p.onAddAnother} data-testid="vr-add-another"
                    className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-700 text-[17px] font-extrabold text-white active:scale-95">
                    <Mic size={20} aria-hidden="true" /> {RS.addAnother}
                </button>
            </div>
            {card && kit && <ProductCard item={card.item} logId={card.logId} kit={kit} onClose={() => setCard(null)} />}
        </div>
    );
};

export default VoiceResultScreen;
