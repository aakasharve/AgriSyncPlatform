/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (founder 2026-11-26: "exact replication of what we built") — the v2 DETAIL page ("आजचा आढावा
 * बघा" on the saved screen opens it; it replaces the old result screen as the detail page while the flag is on). Drawn as the
 * approved design draws `openAadhava` (sathi-ring.src.html + flow4/flow5), full screen in the design's frame (`V2Shell`, the slim
 * bar saying "शेतीचा आढावा" and "या महिन्यात N दिवस"). Top to bottom:
 *   - the container's banners and the red mix banner (verdicts derived on read, as on the saved screen);
 *   - the chips: the place, the day (the existing move-day chip when offered), "N नोंदी" (the day's recordings, counted from the
 *     screen's own rows); who told it today (`SavedSpeakers`);
 *   - the record card (`DetailRecordCard`: badges, his voice big, his words with "श्रम साथीला हे का समजले?" and the unclear box,
 *     the owner's "पक्कं आहे", "✎ बदला");
 *   - "औषध / खत" (`SavedGiven`: each product row opens the product card), the parts with अडथळा (`SavedPartsGrid`);
 *   - Sathi's ONE question and the other post-save surfaces, as the container draws them;
 *   - the day's earlier recordings, OPEN, each playable (`SavedEarlier`);
 *   - "मंजुरीसाठी N" (`DetailApproval`: only for someone the approval list says may confirm, never a made-up count);
 *   - the footer: "← मागे" (back to the saved screen) and "🎤 आणखी सांगा" (the existing next recording).
 * Presentational: no save call, no projected number, nothing summed (P4, P7).
 */
import React, { useMemo, useRef, useState } from 'react';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { SHIPPABLE_RULES, type MixRule } from '../../../../domain/inputs/mixVerdict';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { dayRel, dayShort } from '../dayPick/dayWords';
import { dayLinesOf, lineKeyOfVerdict } from '../voiceResult/DaySummaryLines';
import { MixBanner, tankVerdictsOf } from '../voiceResult/MixBox';
import type { ProductAnswerKit } from '../voiceResult/ProductCard';
import type { ProductItem } from '../voiceResult/productModel';
import { resultCopy } from '../voiceResult/resultCopy';
import type { DayView, PartKey, RecordingView } from '../voiceResult/resultModel';
import { useResultStr } from '../voiceResult/resultStrings';
import { scrollBelowHeader } from '../voiceResult/scrollBelowHeader';
import type { LogSyncState } from '../voiceResult/useRecordingTrust';
import DetailApproval from './DetailApproval';
import DetailRecordCard, { type DetailConfirm } from './DetailRecordCard';
import { MicGlyph, SANS } from './savedBits';
import SavedEarlier from './SavedEarlier';
import SavedGiven from './SavedGiven';
import SavedPartsGrid from './SavedPartsGrid';
import SavedProductCard from './SavedProductCard';
import SavedSpeakers, { HEAD_CHIP } from './SavedSpeakers';
import { savedWords } from './savedWords';
import V2Shell from './V2Shell';

export interface DetailPageProps {
    day: DayView;
    placeLabel: string | ((language: string | undefined) => string);
    farmId: string | null;
    farmRole: string | null | undefined;
    days: number | null;
    unclear: readonly string[];
    clips: ReadonlyMap<string, VoiceClipCacheRecord>;
    playingId: string | null;
    lengthOf: (logId: string) => number | null;
    onTogglePlay: (logId: string) => void;
    sync: LogSyncState;
    syncQueuedOf: (logId: string) => boolean | null | undefined;
    confirm: DetailConfirm;
    onEdit: (logId: string) => void;
    onTellMore: (part: PartKey) => void;
    onChangeDay?: () => void;
    questionPanel?: React.ReactNode;
    extras?: React.ReactNode;
    answerKit?: ProductAnswerKit;
    mixRules?: readonly MixRule[];
    /** Back to the saved screen. */
    onBack: () => void;
    onAddAnother: () => void;
    top?: React.ReactNode;
    sheet?: React.ReactNode;
}

/** The design's `.rbar` buttons. */
const RBAR = 'flex min-h-[52px] flex-1 items-center justify-center gap-1.5 rounded-[14px] px-2.5 py-[11px] text-[15px] font-extrabold active:scale-[0.98]';

export const DetailPage: React.FC<DetailPageProps> = (p) => {
    const { day } = p;
    const primary: RecordingView | undefined = day.current.find(r => !!r.transcript) ?? day.current[0];
    const [card, setCard] = useState<{ item: ProductItem; logId: string } | null>(null);
    const root = useRef<HTMLDivElement>(null);
    const kit = p.answerKit;
    const rules = p.mixRules ?? SHIPPABLE_RULES;
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
    const SW = savedWords(language);
    const nd = (text: string): string => digitsFor(text, language);
    const onDay = primary.log.date && primary.log.date !== getDateKey() ? nd(dayShort(primary.log.date, language)) : null;
    const dayText = nd(dayRel(primary.log.date, getDateKey(), language));
    const records = day.earlier.length + 1;
    const place = typeof p.placeLabel === 'function' ? p.placeLabel(language) : p.placeLabel;
    const nowLines = dayLinesOf(day, language, 'now');
    const redHint = (() => {
        const v = reds[0];
        const lines = dayLinesOf(day, language);
        const box = v ? lines.find(l => l.key === lineKeyOfVerdict(lines, v))?.box : undefined;
        const kind = box ? (box.kind === 'spray' ? copy.spray : box.kind === 'drip' ? copy.drip : copy.products) : '';
        return [kind, copy.mixBannerHint].filter(Boolean).join(' · ');
    })();
    // The banner brings the wrong tank into view: this recording's under "औषध / खत", an earlier one's in the open list below.
    const openRed = (v: (typeof reds)[number]) => {
        const key = nowLines.find(l => l.key === `inputs:${v.hostEventId}`)?.key;
        const el = root.current?.querySelector<HTMLElement>(key ? `[data-testid="vr2-given-${key}"]` : `[data-testid="vr-earlier-${v.logId}"]`)
            ?? root.current?.querySelector<HTMLElement>('[data-testid="vr2-earlier"]');
        scrollBelowHeader(el);
    };
    const addedEntries = day.current.flatMap(r => r.entries);
    const speakerDone = !!kit && !kit.canCheck && addedEntries.some(e => e.products?.items.some(i => !!i.ref));

    const footer = (
        <div className="flex gap-2.5 px-3.5 pb-3.5 pt-2.5" data-testid="vr2d-bar" style={{ fontFamily: SANS }}>
            <button type="button" onClick={p.onBack} data-testid="vr2d-back" className={`${RBAR} border-[1.5px] border-[#DDE3DA] bg-white text-[#1C1917]`}>
                <span aria-hidden="true">←</span> {RS.back}
            </button>
            <button type="button" onClick={p.onAddAnother} data-testid="vr2d-add-another" className={`${RBAR} bg-[#0F6B3A] text-white`}>
                <MicGlyph size={18} /> {RS.addAnother}
            </button>
        </div>
    );

    return (
        <V2Shell place={SW.aadhava} days={p.days} footer={footer} testId="vr2d-shell">
            <div ref={root} className="space-y-3 pt-1" style={{ fontFamily: SANS }} data-testid="vr2-detail">
                {p.top && <div className="-mx-3 -mt-2 empty:hidden" data-testid="vr2d-top">{p.top}</div>}
                <MixBanner reds={reds} hint={redHint} onOpen={openRed} />
                <div className="flex flex-wrap items-center gap-1.5" data-testid="vr2d-chips">
                    <span className={HEAD_CHIP} data-testid="vr2d-place">{place}</span>
                    {p.onChangeDay
                        ? <button type="button" onClick={p.onChangeDay} data-testid="vr2d-day" className={`${HEAD_CHIP} border-[#94A3B8]`}>{dayText} ▾</button>
                        : <span className={HEAD_CHIP} data-testid="vr2d-day">{dayText}</span>}
                    <span className={HEAD_CHIP} data-testid="vr2d-records">{SW.records(records, nd(String(records)))}</span>
                </div>
                <SavedSpeakers day={day} onDay={onDay} testId="vr2d-speakers" />

                <DetailRecordCard day={day} primary={primary} farmRole={p.farmRole} unclear={p.unclear} clips={p.clips} playingId={p.playingId}
                    lengthOf={p.lengthOf} onTogglePlay={p.onTogglePlay} sync={p.sync} syncQueuedOf={p.syncQueuedOf} confirm={p.confirm}
                    onEdit={p.onEdit} speakerDone={speakerDone} />

                <SavedGiven day={day} kit={kit} verdicts={verdicts} title={SW.productsTitle}
                    onOpen={kit ? (item, logId) => setCard({ item, logId }) : () => undefined} />
                <SavedPartsGrid day={day} onTellMore={p.onTellMore} />

                {p.questionPanel && <div data-testid="vr2d-question">{p.questionPanel}</div>}
                {p.extras}

                <SavedEarlier earlier={day.earlier} onDay={onDay} clips={p.clips} playingId={p.playingId} lengthOf={p.lengthOf}
                    onTogglePlay={p.onTogglePlay} open />
                <DetailApproval farmId={p.farmId} />

                {card && kit && <SavedProductCard item={card.item} logId={card.logId} kit={kit} onClose={() => setCard(null)} />}
                {p.sheet}
            </div>
        </V2Shell>
    );
};

export default DetailPage;
