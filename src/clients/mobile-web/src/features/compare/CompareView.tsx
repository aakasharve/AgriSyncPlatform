/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T v4; D-68, D-83 = 1, D-104, D-139 fifth note / F259; R10, R12, R33, R34;
 * P4, P5, P9, P10) - screen 2 of तुलना, drawn from the SERVER's answer for one plot (thin client): the crop+plot chip, the stage line,
 * ONE primary card (the schedule the server marked main), the other schedules as name + count, four category tiles, and the sheets.
 *
 * The phone never recounts a stage, never clips a window and never decides what "matched" means. Numbers are the server's; the few sums the
 * phone adds are named in `compareFacts.ts`. Two colours only: green and grey. "अजून नोंद नाही", never "राहिलं" / "काम झालं नाही".
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, HelpCircle, WifiOff } from 'lucide-react';
import type { CropProfile, FarmerProfile } from '../../types';
import { useUiPref } from '../../shared/hooks/useUiPref';
import { formatUpToWhen } from '../oversight/formatUpToWhen';
import { digitsFor } from '../../shared/utils/marathiDigits';
import { scheduleNameIn } from '../../shared/names/namesIn';
import type { FarmCompareResult } from './data/compareClient';
import type { PlotCompareDto, ScheduleCompareDto } from './data/compareDtos';
import { Dots, PartIcon, SANS_FONT } from './compareBits';
import { n, PART_ORDER, compareWords, langOf, type PartKey } from './compareWords';
import {
    countsAt, headlineOf, isOwnSchedule, isPart, itemsOfPart, mainScheduleOf, noRecordOf, notRecognisedAt, openingStage, ownKey, ownWorkAt,
    partTotals, type OwnWorkDto,
} from './compareFacts';
import {
    CategorySheet, OrderNotes, OwnRow, RefSheet, RowSheet, ScheduleCount, stageLabel,
    type SheetContext, type SheetState, type ShownReason,
} from './CompareSheets';
import OwnWorkSheet from './OwnWorkSheet';
import CompareCoach from './CompareCoach';
import { useOnline } from './useOnline';

export interface CompareViewProps {
    result: Extract<FarmCompareResult, { kind: 'compare' }>;
    plot: PlotCompareDto | null;
    farmId: string;
    chip: string;
    language: string | null | undefined;
    crops: CropProfile[];
    profile?: FarmerProfile;
    onChange: () => void;
    onOpenSchedule?: () => void;
}

const Line: React.FC<{ children: React.ReactNode; testId?: string }> = ({ children, testId }) => (
    <p className="m-0 rounded-2xl bg-white p-4 text-[16px] font-bold leading-snug text-stone-800 shadow-sm" data-testid={testId}>{children}</p>
);

export const CompareView: React.FC<CompareViewProps> = ({ result, plot, farmId, chip, language, crops, profile, onChange, onOpenSchedule }) => {
    const lang = langOf(language);
    const words = compareWords(language);
    const online = useOnline();
    const [stageAt, setStageIndex] = useState(() => (plot ? openingStage(plot.stages) : 0));
    // a newer answer may hold fewer stages than the one he stepped to: the view follows the answer it is shown with
    const stageIndex = plot ? Math.max(0, Math.min(stageAt, plot.stages.length - 1)) : 0;
    const [stack, setStack] = useState<SheetState[]>([]);
    const [kept, setKept] = useState<Record<string, ShownReason>>({});
    const [seen, setSeen, seenLoaded] = useUiPref<boolean>('compare_coach_seen_v1', false);
    const [coachOpen, setCoachOpen] = useState(false);

    const primary = plot ? mainScheduleOf(plot) : null;
    const others = useMemo<ScheduleCompareDto[]>(() => (plot ? plot.schedules.filter(s => s !== primary) : []), [plot, primary]);
    const stage = plot?.stages[stageIndex] ?? null;
    const passed = stage?.state === 'passed';
    const primaryCounts = plot && primary ? countsAt(primary, stageIndex) : null;
    const showsNumbers = !!plot && !!stage && stage.state !== 'ahead';

    // the coach shows once, by itself, the first time a plot's numbers are drawn
    useEffect(() => {
        if (seenLoaded && !seen && primaryCounts) setCoachOpen(true);
    }, [seenLoaded, seen, primaryCounts !== null]); // eslint-disable-line react-hooks/exhaustive-deps
    const finishCoach = () => { setCoachOpen(false); if (!seen) setSeen(true); };

    const go = (to: number) => { setStack([]); setStageIndex(to); };
    const top = stack[stack.length - 1] ?? null;
    const open = (s: SheetState) => setStack(cur => [...cur, s]);
    const close = () => setStack([]);
    const back = stack.length > 1 ? () => setStack(cur => cur.slice(0, -1)) : undefined;

    const ownLabel = primary ? (isOwnSchedule(primary) ? words.mainOwn : words.mainOf(scheduleNameIn(primary.name, lang))) : '';
    const reasonOf = (o: OwnWorkDto): ShownReason | null =>
        kept[ownKey(o)] ?? (o.reason ? { kind: o.reason.kind, words: o.reason.words && o.reason.words.trim() ? o.reason.words : null, saidByVoice: o.reason.saidByVoice } : null);
    const ctx: SheetContext | null = plot && stage ? {
        lang, words, plot, stageIndex, stageName: stageLabel(stage.name, lang), passed, daysLeft: stage.daysLeft, primary, others, ownLabel, reasonOf,
    } : null;

    const when = result.source === 'cache' ? formatUpToWhen(result.asOfUtc, lang) : null;
    const freshness = result.source === 'cache' ? (when ? words.offlineAsOf(digitsFor(when, lang)) : words.offlineAsOfUnknown) : null;

    // ---- the body
    let body: React.ReactNode;
    if (!plot) {
        body = <Line testId="compare-plot-missing">{words.plotNotInAnswer}</Line>;
    } else if (plot.schedules.length === 0) {
        // after the trial with nothing followed the server counts nothing and never names the gate (D-83 = 1): the screen only says to choose
        body = (
            <div className="rounded-2xl bg-white p-5 text-center shadow-sm" data-testid="compare-choose-schedule">
                <p className="m-0 text-[20px] font-extrabold text-stone-900">{words.chooseScheduleFirst}</p>
                {onOpenSchedule && (
                    <button type="button" onClick={onOpenSchedule} data-testid="compare-choose-schedule-button"
                        className="mt-3 inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-emerald-700 px-4 text-[17px] font-extrabold text-white">{words.chooseSchedule}</button>
                )}
            </div>
        );
    } else if (plot.stages.length === 0 || !stage) {
        body = <Line testId="compare-no-stages">{words.noStages}</Line>;
    } else if (!showsNumbers) {
        body = (
            <>
                <div className="rounded-2xl bg-white p-5 text-center shadow-sm" data-testid="compare-stage-ahead">
                    <p className="m-0 text-[20px] font-extrabold text-stone-900">{stageLabel(stage.name, lang)}</p>
                    <p className="m-0 mt-1 text-[16px] font-bold text-stone-700">{words.stageNotStarted}</p>
                </div>
                {others.length > 0 && <OtherSchedules ctx={ctx!} schedules={others} onOpen={open} />}
            </>
        );
    } else if (!primaryCounts && others.every(s => !countsAt(s, stageIndex))) {
        body = <Line testId="compare-stage-no-numbers">{words.stageNoNumbers}</Line>;
    } else {
        const c = ctx!;
        const ownHere = ownWorkAt(plot, stageIndex);
        const lost = notRecognisedAt(plot, stageIndex);
        body = (
            <>
                {primary && primaryCounts && <PrimaryCard ctx={c} schedule={primary} fresh={result.source === 'server'} />}
                {!primary && <Line testId="compare-no-main">{words.noFollowedSchedule}</Line>}
                {others.length > 0 && <OtherSchedules ctx={c} schedules={others} onOpen={open} />}
                {primary && primaryCounts && (
                    <div className="grid grid-cols-2 gap-2.5" data-testid="compare-tiles">
                        {PART_ORDER.map(part => <Tile key={part} ctx={c} part={part} counts={primaryCounts} own={ownHere} onOpen={() => open({ kind: 'cat', part })} />)}
                    </div>
                )}
                {!primaryCounts && ownHere.length > 0 && (
                    <div className="flex flex-col gap-1.5" data-testid="compare-own-list">
                        {ownHere.map(o => <OwnRow key={ownKey(o)} ctx={c} own={o} onOpen={() => open({ kind: 'own', key: ownKey(o) })} />)}
                    </div>
                )}
                {lost.length > 0 && (
                    <div className="rounded-2xl border border-stone-300 bg-white p-3" data-testid="compare-not-recognised">
                        <b className="block text-[16px] text-stone-900">{words.notRecognised}</b>
                        {lost.map(l => <p key={ownKey(l)} className="m-0 mt-1 text-[15px] font-semibold text-stone-800" data-testid="compare-not-recognised-item">{l.title ? l.title : words.oneRecord}</p>)}
                    </div>
                )}
            </>
        );
    }

    // ---- the sheet on top
    let sheet: React.ReactNode = null;
    if (top && ctx && plot) {
        if (top.kind === 'cat') sheet = <CategorySheet ctx={ctx} part={top.part} onOpen={open} onClose={close} />;
        else if (top.kind === 'ref') {
            const s = plot.schedules.find(x => x.subscriptionId === top.subscriptionId);
            if (s) sheet = <RefSheet ctx={ctx} schedule={s} onOpen={open} onClose={close} onBack={back} />;
        } else if (top.kind === 'row') {
            const s = plot.schedules.find(x => x.subscriptionId === top.subscriptionId);
            if (s) sheet = <RowSheet ctx={ctx} schedule={s} activityId={top.activityId} onClose={close} onBack={back} />;
        } else {
            const o = plot.ownWork.find(x => ownKey(x) === top.key);
            if (o) sheet = <OwnWorkSheet key={top.key} ctx={ctx} own={o} farmId={farmId} online={online} crops={crops} profile={profile}
                onKept={(item, reason) => setKept(cur => ({ ...cur, [ownKey(item)]: reason }))} onClose={close} onBack={back} />;
        }
    }

    return (
        <div className="space-y-3 px-3 pb-24 pt-2" style={{ fontFamily: SANS_FONT }} data-testid="compare-screen">
            <div className="flex items-center gap-2">
                <button type="button" onClick={onChange} data-testid="compare-chip" aria-label={`${chip} · ${words.change}`}
                    className="flex min-h-[48px] min-w-0 flex-1 items-center gap-1.5 rounded-2xl border-2 border-emerald-700 bg-white px-2 text-left text-[16px] font-extrabold text-emerald-900">
                    <ChevronLeft size={18} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{chip}</span>
                    <span className="shrink-0 text-[14px] font-bold text-stone-600">{words.change}</span>
                </button>
                <button type="button" onClick={() => { setStack([]); setCoachOpen(true); }} data-testid="compare-help" aria-label={words.help}
                    className="grid min-h-[48px] min-w-[48px] place-items-center rounded-2xl border-2 border-stone-300 bg-white text-stone-800"><HelpCircle size={22} aria-hidden="true" /></button>
            </div>
            {freshness && (
                <div className="flex items-center gap-2 rounded-xl bg-stone-200 px-3 py-2 text-[14px] font-bold text-stone-800" data-testid="compare-offline-strip" role="status">
                    <WifiOff size={18} aria-hidden="true" className="shrink-0" /><span>{freshness}</span>
                </div>
            )}
            {plot && plot.schedules.length > 0 && plot.stages.length > 0 && stage && (
                <div className="flex items-center gap-2 rounded-2xl bg-white p-2 shadow-sm" data-testid="compare-stage-line">
                    <button type="button" disabled={stageIndex <= 0} onClick={() => go(stageIndex - 1)} data-testid="compare-stage-prev" aria-label={`${words.previousStage}`}
                        className="inline-flex min-h-[48px] shrink-0 items-center gap-1 rounded-xl border border-stone-300 px-2 text-[14px] font-extrabold text-stone-900 disabled:opacity-40"><ChevronLeft size={16} aria-hidden="true" />{words.previousStage}</button>
                    <div className="min-w-0 flex-1 text-center">
                        <b className="block truncate text-[17px] text-stone-900" data-testid="compare-stage-name">{stageLabel(stage.name, lang)}</b>
                        <small className="block text-[14px] font-bold text-stone-700" data-testid="compare-stage-sub">
                            {stage.state === 'current' ? (stage.daysLeft !== null ? words.daysLeft(stage.daysLeft) : '') : stage.state === 'passed' ? words.stageEnded : words.stageNotStarted}
                        </small>
                    </div>
                    <button type="button" disabled={stageIndex >= plot.stages.length - 1} onClick={() => go(stageIndex + 1)} data-testid="compare-stage-next" aria-label={`${words.nextStage}`}
                        className="inline-flex min-h-[48px] shrink-0 items-center gap-1 rounded-xl border border-stone-300 px-2 text-[14px] font-extrabold text-stone-900 disabled:opacity-40">{words.nextStage}<ChevronRight size={16} aria-hidden="true" /></button>
                </div>
            )}
            {body}
            {sheet}
            {coachOpen && <CompareCoach words={words} lang={lang} onFinish={finishCoach} />}
        </div>
    );
};

const PrimaryCard: React.FC<{ ctx: SheetContext; schedule: ScheduleCompareDto; fresh: boolean }> = ({ ctx, schedule, fresh }) => {
    const { words, lang, passed } = ctx;
    const counts = countsAt(schedule, ctx.stageIndex)!;
    const h = headlineOf(counts);
    const gap = counts.asked !== null && counts.notYet !== null ? noRecordOf(counts.notYet, counts.saidNotDone) : 0;
    const asked = counts.asked ?? 0;
    const done = counts.done ?? 0;
    return (
        <section className="rounded-3xl border-2 border-emerald-700 bg-white p-4 shadow-md" data-testid="compare-primary-card">
            <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-[14px] font-extrabold text-emerald-900" data-testid="compare-primary-tag">{ctx.ownLabel}</span>
                {fresh && <span className="text-[14px] font-bold text-stone-600" data-testid="compare-fresh">{words.freshNow}</span>}
            </div>
            <div className="mt-3" data-testid="compare-headline">
                {h.kind === 'nothingAsked' && <p className="m-0 text-[18px] font-extrabold text-stone-900">{words.noWorkInStage}</p>}
                {h.kind === 'zero' && <p className="m-0 text-[24px] font-extrabold text-stone-900">{passed ? words.didNotComeToRecord : words.noRecordYet}</p>}
                {h.kind === 'matched' && <p className="m-0 text-[24px] font-extrabold text-emerald-800">{words.sameAsScheduleAll}</p>}
                {h.kind === 'cameOnly' && <p className="m-0 text-[22px] font-extrabold text-emerald-800">{words.cameInRecord(h.came)}</p>}
                {h.kind === 'noRecord' && (
                    <>
                        <p className="m-0 flex items-baseline gap-2"><b className="text-[40px] leading-none text-stone-900" data-testid="compare-headline-number">{n(lang, h.count)}</b><span className="text-[18px] font-extrabold text-stone-900">{words.noRecordWork(h.count, passed)}</span></p>
                        {h.said > 0 && <p className="m-0 mt-1 text-[15px] font-bold text-stone-700">{words.andSaidNotDone(h.said)}</p>}
                    </>
                )}
                {h.kind === 'saidOnly' && <p className="m-0 flex items-baseline gap-2"><b className="text-[40px] leading-none text-stone-900" data-testid="compare-headline-number">{n(lang, h.said)}</b><span className="text-[18px] font-extrabold text-stone-900">{words.saidNotDone}</span></p>}
            </div>
            {counts.asked !== null && counts.done !== null && counts.notYet !== null && counts.asked > 0 && (
                <div className="mt-3" role="img" aria-label={words.storyLabel(asked, done)} data-testid="compare-story">
                    <div className="flex h-4 gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
                        {Array.from({ length: done }, (_, i) => <i key={`g${i}`} className="h-full flex-1 bg-emerald-600" />)}
                        {Array.from({ length: counts.saidNotDone }, (_, i) => <i key={`s${i}`} className="h-full flex-1 border-y-2 border-dashed border-stone-500 bg-white" />)}
                        {Array.from({ length: gap }, (_, i) => <i key={`r${i}`} className="h-full flex-1 bg-stone-300" />)}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 text-[14px] font-bold text-stone-800">
                        <span className="text-emerald-800">{words.storyDone} <b data-testid="compare-story-done">{n(lang, done)}</b></span>
                        <span>{words.storyAsked} <b data-testid="compare-story-asked">{n(lang, asked)}</b></span>
                        <span>{words.storyNoRecord(passed)} <b data-testid="compare-story-none">{n(lang, gap)}</b></span>
                    </div>
                </div>
            )}
            <OrderNotes ctx={ctx} schedule={schedule} />
            <p className="m-0 mt-3 text-[14px] font-bold text-stone-700" data-testid="compare-plain-line">{words.plainNoRecord}</p>
        </section>
    );
};

const OtherSchedules: React.FC<{ ctx: SheetContext; schedules: readonly ScheduleCompareDto[]; onOpen: (s: SheetState) => void }> = ({ ctx, schedules, onOpen }) => {
    const { words, lang } = ctx;
    return (
        <section className="rounded-3xl border border-stone-300 bg-white p-3" data-testid="compare-others">
            <div className="flex items-baseline justify-between gap-2 px-1">
                <b className="text-[16px] text-stone-900">{words.otherSchedules(schedules.length)}</b>
                <small className="text-[14px] font-bold text-stone-600">{words.referenceOnly}</small>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
                {schedules.map(s => {
                    const has = !!countsAt(s, ctx.stageIndex);
                    const inner = (
                        <>
                            <span className="min-w-0 flex-1">
                                <b className="block text-[16px] text-stone-900" data-testid="compare-other-name">{scheduleNameIn(s.name, lang)}</b>
                                {has && <ScheduleCount ctx={ctx} schedule={s} />}
                            </span>
                            {has && <ChevronRight size={16} className="shrink-0 text-stone-500" aria-hidden="true" />}
                        </>
                    );
                    return has
                        ? <button key={s.subscriptionId} type="button" onClick={() => onOpen({ kind: 'ref', subscriptionId: s.subscriptionId })} data-testid={`compare-other-${s.subscriptionId}`}
                            className="flex min-h-[56px] w-full items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-left">{inner}</button>
                        : <div key={s.subscriptionId} data-testid={`compare-other-${s.subscriptionId}`} className="flex min-h-[56px] w-full items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-left">{inner}</div>;
                })}
            </div>
        </section>
    );
};

const Tile: React.FC<{ ctx: SheetContext; part: PartKey; counts: NonNullable<ReturnType<typeof countsAt>>; own: readonly OwnWorkDto[]; onOpen: () => void }> = ({ ctx, part, counts, own, onOpen }) => {
    const { words, passed } = ctx;
    const items = itemsOfPart(counts, part);
    const ownHere = own.filter(o => (isPart(o.part) ? o.part : 'work') === part).length;
    const t = partTotals(items);
    const otherHas = items.length === 0 && ctx.others.some(s => itemsOfPart(countsAt(s, ctx.stageIndex), part).length > 0);
    const zero = passed ? words.didNotComeToRecord : words.noRecordYet;
    const none = t.stored ? noRecordOf(t.notYet, t.said) : 0;
    // "no record" words only where nothing was said about the work; open works that were ALL said not done say that instead (P003)
    const text = items.length === 0 ? words.notInPlan
        : t.stored ? (t.done === 0 ? (t.said === 0 ? zero : none === 0 ? words.saidNotDone : words.outOfMatched(t.asked, t.done)) : words.outOfMatched(t.asked, t.done))
            : (t.came > 0 ? words.cameInRecord(t.came) : zero);
    const green = t.stored && t.asked > 0 && t.done === t.asked;
    return (
        <button type="button" onClick={onOpen} data-testid={`compare-tile-${part}`}
            className={`flex min-h-[88px] flex-col items-start gap-1.5 rounded-2xl border-2 bg-white px-3 py-2.5 text-left ${items.length > 0 || ownHere > 0 ? 'border-stone-300' : 'border-dashed border-stone-300'}`}>
            <span className="flex w-full items-center gap-2"><PartIcon part={part} size={18} /><b className="min-w-0 flex-1 text-[15px] leading-tight text-stone-900">{words.partName[part]}</b><ChevronRight size={14} className="shrink-0 text-stone-500" aria-hidden="true" /></span>
            {items.length > 0 && <span className="flex flex-wrap items-center gap-[3px]" data-testid={`compare-tile-${part}-dots`}>
                <Dots tone="done" count={t.stored ? t.done : t.came} /><Dots tone="said" count={t.said} /><Dots tone="none" count={none} />
            </span>}
            <span className={`text-[14px] font-bold ${green ? 'text-emerald-800' : 'text-stone-800'}`} data-testid={`compare-tile-${part}-text`}>{text}</span>
            {otherHas && <span className="text-[14px] font-semibold text-stone-600">{words.inOtherSchedules}</span>}
            {ownHere > 0 && <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[14px] font-bold text-stone-800" data-testid={`compare-tile-${part}-own`}>{words.notInScheduleCount(ownHere)}</span>}
        </button>
    );
};

export default CompareView;
