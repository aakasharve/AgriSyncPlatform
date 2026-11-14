/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T v4; D-68, D-139 fifth note; R12, R33, R34; P4, P5, P9)
 *
 * The bottom sheets of तुलना, drawn from the server's answer only: a category's mirror (the schedule says -> you did), the 3-step
 * "समजून घ्या" of one work, and another schedule's rows (for reference only). Matched work shows COUNTS only: the server sends days
 * for his own work alone, so no date is drawn for a matched row (and none is invented). A hidden record is counted as done by the server
 * and never named: nothing here draws a record's words except an own-work item's `title` (null when withheld -> "एक नोंद").
 */
import React from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useBackDismiss } from '../../core/navigation/useBackDismiss';
import { PHONE_COLUMN } from '../logs/components/phoneColumn';
import { taskNameIn, scheduleNameIn, stageNameIn } from '../../shared/names/namesIn';
import type { ScheduleCompareDto } from './data/compareDtos';
import { Dots, GreyNumber, KIND_ICON, PartIcon, SANS_FONT, TickMark } from './compareBits';
import { n, PART_ORDER, type CompareLang, type CompareWords, type PartKey } from './compareWords';
import {
    allItems, countsAt, isPart, itemsOfPart, noRecordOf, ownKey, ownWorkAt, partTotals, recordsCame,
    type ItemDto, type OwnWorkDto,
} from './compareFacts';
import type { PlotCompareDto } from './data/compareDtos';
import type { LogReasonKind } from '../../application/usecases/sync/SetLogReasonCommand';

export type SheetState =
    | { kind: 'cat'; part: PartKey }
    | { kind: 'ref'; subscriptionId: string }
    | { kind: 'row'; subscriptionId: string; activityId: string }
    | { kind: 'own'; key: string };

/** What a reason looks like on the screen (the server's, or the one he just kept on this phone). */
export interface ShownReason { kind: LogReasonKind; words: string | null; saidByVoice: boolean }

export interface SheetContext {
    lang: CompareLang;
    words: CompareWords;
    plot: PlotCompareDto;
    stageIndex: number;
    stageName: string;
    passed: boolean;
    daysLeft: number | null;
    primary: ScheduleCompareDto | null;
    others: readonly ScheduleCompareDto[];
    ownLabel: string;
    reasonOf: (o: OwnWorkDto) => ShownReason | null;
}

/** The shell: dim background (tap closes), a panel at the bottom, a back button when it was opened from another sheet, a close button. */
export const SheetShell: React.FC<{
    title: string; subtitle?: string; icon?: React.ReactNode; words: CompareWords; onClose: () => void; onBack?: () => void;
    testId: string; children: React.ReactNode;
}> = ({ title, subtitle, icon, words, onClose, onBack, testId, children }) => {
    useBackDismiss(true, onBack ?? onClose);
    return (
        <div className="fixed inset-0 z-[88] flex items-end justify-center bg-stone-900/40" data-testid="compare-sheet-veil" onClick={onClose}>
            <div role="dialog" aria-modal="true" aria-label={title} data-testid={testId} onClick={e => e.stopPropagation()}
                className={`max-h-[88vh] overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 shadow-2xl ${PHONE_COLUMN}`} style={{ fontFamily: SANS_FONT }}>
                <div className="mb-3 flex items-start gap-2">
                    {onBack && (
                        <button type="button" onClick={onBack} data-testid="compare-sheet-back"
                            className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-xl border border-stone-300 bg-white px-3 text-[14px] font-extrabold text-stone-900">
                            <ChevronLeft size={16} aria-hidden="true" />{words.back}
                        </button>
                    )}
                    {icon}
                    <h3 className="m-0 min-w-0 flex-1 text-[18px] font-extrabold leading-tight text-stone-900">
                        {title}
                        {subtitle && <small className="mt-0.5 block text-[14px] font-bold text-stone-600">{subtitle}</small>}
                    </h3>
                    <button type="button" onClick={onClose} data-testid="compare-sheet-close"
                        className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-xl border border-stone-300 bg-white px-3 text-[14px] font-extrabold text-stone-900">
                        <X size={16} aria-hidden="true" />{words.close}
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
};

const Note: React.FC<{ children: React.ReactNode; testId?: string }> = ({ children, testId }) => (
    <p className="m-0 mt-3 rounded-xl bg-stone-100 px-3 py-2 text-[14px] font-semibold leading-snug text-stone-700" data-testid={testId}>{children}</p>
);

const ColumnHeads: React.FC<{ words: CompareWords }> = ({ words }) => (
    <div className="mb-1 grid grid-cols-[1fr_32px_1fr] items-center gap-2 px-1 text-[14px] font-bold text-stone-600">
        <span>{words.colSchedule}</span><span /><span className="text-right">{words.colYou}</span>
    </div>
);

/** One work of a schedule as a mirror row: asked dots | middle mark | done dots. Everything is the server's number for that work. */
export const MirrorRow: React.FC<{ ctx: SheetContext; item: ItemDto; part: PartKey; onOpen?: () => void; testId: string }> = ({ ctx, item, part, onOpen, testId }) => {
    const { words, lang, passed } = ctx;
    const stored = item.asked !== null && item.notYet !== null;
    const none = stored ? noRecordOf(item.notYet ?? 0, item.saidNotDone) : 0;
    // ONE count of "no record" on the row, the tile and the headline; when nothing is left but works he said he did not do, that count
    const shownNone = none > 0 ? none : item.saidNotDone;
    const label = none > 0 ? (passed ? words.didNotComeToRecord : words.noRecordYet) : words.saidNotDone;
    const body = (
        <>
            <span className="flex items-center gap-2">
                <PartIcon part={part} size={18} />
                <span className="min-w-0 flex-1 text-[16px] font-extrabold leading-snug text-stone-900">{taskNameIn(item.title, lang)}</span>
                {item.moreThanAsked > 0 && <span className="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 text-[14px] font-bold text-stone-800">{words.moreThanSchedule(item.moreThanAsked)}</span>}
                {onOpen && <ChevronRight size={16} className="shrink-0 text-stone-500" aria-hidden="true" />}
            </span>
            <span className="mt-1.5 grid grid-cols-[1fr_32px_1fr] items-center gap-2">
                <span className="flex flex-wrap items-center gap-1.5">
                    {stored
                        ? <><Dots tone="asked" count={item.asked ?? 0} /><b className="text-[15px] text-stone-800" data-testid={`asked:${testId}`}>{n(lang, item.asked ?? 0)}</b></>
                        : <i className="inline-block h-[3px] w-5 rounded bg-stone-300" aria-hidden="true" />}
                </span>
                {stored
                    ? (item.notYet === 0 ? <TickMark label={words.sameAsScheduleAll} /> : <GreyNumber text={n(lang, shownNone)} label={label} said={none === 0} />)
                    : <span className="h-[26px] w-[26px]" aria-hidden="true" />}
                <span className="flex flex-wrap items-center justify-end gap-1.5">
                    <Dots tone="done" count={item.done} /><b className="text-[15px] text-emerald-800" data-testid={`done:${testId}`}>{n(lang, item.done)}</b>
                </span>
            </span>
            {!stored && <span className="mt-1 block text-[14px] font-bold text-stone-700">{words.cameInRecord(item.done)}</span>}
            {item.saidNotDone > 0 && <span className="mt-1 block text-[14px] font-bold text-stone-700">{words.saidNotDone}</span>}
        </>
    );
    const cls = 'block w-full rounded-2xl border border-stone-200 bg-white px-3 py-2.5 text-left';
    return onOpen
        ? <button type="button" onClick={onOpen} data-testid={testId} className={`${cls} min-h-[56px]`}>{body}</button>
        : <div data-testid={testId} className={cls}>{body}</div>;
};

/** A record of work none of the schedules asks (the server's `ownWork`): one more row in the same mirror, neutral, no tick, no gap number. */
export const OwnRow: React.FC<{ ctx: SheetContext; own: OwnWorkDto; onOpen: () => void }> = ({ ctx, own, onOpen }) => {
    const { words, lang } = ctx;
    const reason = ctx.reasonOf(own);
    const KindIcon = reason ? KIND_ICON[reason.kind] : null;
    return (
        <button type="button" onClick={onOpen} data-testid={`compare-own-row-${ownKey(own)}`}
            className="block min-h-[56px] w-full rounded-2xl border border-dashed border-stone-400 bg-white px-3 py-2.5 text-left">
            <span className="flex items-center gap-2">
                <PartIcon part="own" size={18} />
                {/* his own words for the record, or "एक नोंद" when the server withheld them (D-66): never a guess */}
                <span className="min-w-0 flex-1 text-[16px] font-extrabold leading-snug text-stone-900">{own.title ? own.title : words.oneRecord}</span>
                {KindIcon && reason && <span className="shrink-0 text-emerald-800" role="img" aria-label={words.kinds[reason.kind]} data-testid="compare-own-row-reason"><KindIcon size={16} aria-hidden="true" /></span>}
                <ChevronRight size={16} className="shrink-0 text-stone-500" aria-hidden="true" />
            </span>
            <span className="mt-0.5 block text-[14px] font-bold text-stone-700">{words.notInScheduleDidIt}</span>
            <span className="mt-1.5 grid grid-cols-[1fr_32px_1fr] items-center gap-2">
                <i className="inline-block h-[3px] w-5 rounded bg-stone-300" aria-hidden="true" />
                <span className="h-[26px] w-[26px]" aria-hidden="true" />
                <span className="flex items-center justify-end gap-1.5"><Dots tone="done" count={1} /><b className="text-[15px] text-emerald-800">{n(lang, 1)}</b></span>
            </span>
        </button>
    );
};

/** A line for another schedule: its name, its count (never ranked), a tap opens its rows. */
export const ScheduleCount: React.FC<{ ctx: SheetContext; schedule: ScheduleCompareDto }> = ({ ctx, schedule }) => {
    const { words } = ctx;
    const counts = countsAt(schedule, ctx.stageIndex);
    if (!counts) return null;
    const more = counts.moreThanAsked;
    return (
        <>
            {counts.asked !== null && counts.done !== null
                ? <span className="text-[15px] font-bold text-stone-800" data-testid="compare-schedule-count">{words.outOfMatched(counts.asked, counts.done)}</span>
                : <span className="text-[15px] font-bold text-stone-800" data-testid="compare-schedule-count">{words.cameInRecord(recordsCame(counts))}</span>}
            {more > 0 && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-[14px] font-bold text-stone-800">{words.moreThanSchedule(more)}</span>}
        </>
    );
};

export const OrderNotes: React.FC<{ ctx: SheetContext; schedule: ScheduleCompareDto }> = ({ ctx, schedule }) => (
    <>
        {schedule.order.map((o, i) => (
            <p key={i} className="m-0 mt-2 text-[14px] font-semibold text-stone-700" data-testid="compare-order-note">
                {ctx.words.orderNote(scheduleNameIn(schedule.name, ctx.lang), taskNameIn(o.firstTitle, ctx.lang), taskNameIn(o.thenTitle, ctx.lang))}
            </p>
        ))}
    </>
);

export const CategorySheet: React.FC<{ ctx: SheetContext; part: PartKey; onOpen: (s: SheetState) => void; onClose: () => void }> = ({ ctx, part, onOpen, onClose }) => {
    const { words, lang } = ctx;
    const counts = ctx.primary ? countsAt(ctx.primary, ctx.stageIndex) : null;
    const items = itemsOfPart(counts, part);
    const own = ownWorkAt(ctx.plot, ctx.stageIndex).filter(o => (isPart(o.part) ? o.part : 'work') === part);
    const refs = ctx.others.filter(s => itemsOfPart(countsAt(s, ctx.stageIndex), part).length > 0);
    return (
        <SheetShell title={words.partName[part]} subtitle={ctx.primary ? ctx.ownLabel : undefined} icon={<PartIcon part={part} />} words={words} onClose={onClose} testId={`compare-category-${part}`}>
            {items.length > 0 || own.length > 0 ? (
                <>
                    <ColumnHeads words={words} />
                    <div className="flex flex-col gap-1.5">
                        {items.map(item => ctx.primary && (
                            <MirrorRow key={item.activityId} ctx={ctx} item={item} part={part} testId={`compare-row-${item.activityId}`}
                                onOpen={() => onOpen({ kind: 'row', subscriptionId: ctx.primary!.subscriptionId, activityId: item.activityId })} />
                        ))}
                        {own.map(o => <OwnRow key={ownKey(o)} ctx={ctx} own={o} onOpen={() => onOpen({ kind: 'own', key: ownKey(o) })} />)}
                    </div>
                </>
            ) : <p className="m-0 text-[16px] font-bold text-stone-800" data-testid="compare-category-empty">{words.categoryEmpty}</p>}
            {refs.length > 0 && (
                <>
                    <h4 className="m-0 mt-4 text-[15px] font-extrabold text-stone-800">{words.otherSchedulesSay}</h4>
                    <div className="mt-2 flex flex-col gap-1.5">
                        {refs.map(s => {
                            const t = partTotals(itemsOfPart(countsAt(s, ctx.stageIndex), part));
                            return (
                                <button key={s.subscriptionId} type="button" onClick={() => onOpen({ kind: 'ref', subscriptionId: s.subscriptionId })} data-testid={`compare-category-ref-${s.subscriptionId}`}
                                    className="flex min-h-[56px] w-full items-center gap-2 rounded-2xl border border-stone-200 bg-white px-3 py-2 text-left">
                                    <span className="min-w-0 flex-1">
                                        <b className="block text-[16px] text-stone-900">{scheduleNameIn(s.name, lang)}</b>
                                        {t.stored && <span className="text-[15px] font-bold text-stone-800">{words.outOfMatched(t.asked, t.done)}</span>}
                                    </span>
                                    <ChevronRight size={16} className="shrink-0 text-stone-500" aria-hidden="true" />
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
            <Note>{words.plainNoRecord}</Note>
        </SheetShell>
    );
};

export const RefSheet: React.FC<{ ctx: SheetContext; schedule: ScheduleCompareDto; onOpen: (s: SheetState) => void; onClose: () => void; onBack?: () => void }> = ({ ctx, schedule, onOpen, onClose, onBack }) => {
    const { words, lang } = ctx;
    const counts = countsAt(schedule, ctx.stageIndex);
    return (
        <SheetShell title={scheduleNameIn(schedule.name, lang)} subtitle={words.referenceOnly} words={words} onClose={onClose} onBack={onBack} testId={`compare-ref-sheet-${schedule.subscriptionId}`}>
            {counts && <p className="m-0 mb-2 text-[16px] font-extrabold text-stone-900"><ScheduleCount ctx={ctx} schedule={schedule} /></p>}
            <OrderNotes ctx={ctx} schedule={schedule} />
            {counts && allItems(counts).length > 0 && (
                <div className="mt-2">
                    <ColumnHeads words={words} />
                    <div className="flex flex-col gap-1.5">
                        {PART_ORDER.flatMap(part => itemsOfPart(counts, part).map(item => (
                            <MirrorRow key={item.activityId} ctx={ctx} item={item} part={part} testId={`compare-ref-row-${item.activityId}`}
                                onOpen={() => onOpen({ kind: 'row', subscriptionId: schedule.subscriptionId, activityId: item.activityId })} />
                        )))}
                    </div>
                </div>
            )}
            <Note>{words.refNote}</Note>
        </SheetShell>
    );
};

/** The 3 steps of one work: what the schedule said, what was recorded, why it differs. Counts only. */
export const RowSheet: React.FC<{ ctx: SheetContext; schedule: ScheduleCompareDto; activityId: string; onClose: () => void; onBack?: () => void }> = ({ ctx, schedule, activityId, onClose, onBack }) => {
    const { words, lang, passed } = ctx;
    const counts = countsAt(schedule, ctx.stageIndex);
    const found = PART_ORDER.map(part => ({ part, item: itemsOfPart(counts, part).find(i => i.activityId === activityId) })).find(x => x.item);
    if (!found || !found.item) return null;
    const { part, item } = found;
    const stored = item.asked !== null && item.notYet !== null;
    const none = stored ? noRecordOf(item.notYet ?? 0, item.saidNotDone) : 0;
    const lines: string[] = [];
    if (stored && item.notYet === 0 && item.moreThanAsked === 0) lines.push(words.why.matched);
    if (none > 0) lines.push(passed ? words.why.passedNoRecord : words.why.open(ctx.daysLeft));
    if (item.saidNotDone > 0) lines.push(words.why.said);
    if (item.moreThanAsked > 0) lines.push(words.why.more(item.moreThanAsked));
    if (none > 0) lines.push(words.plainNoRecord);
    const title = taskNameIn(item.title, lang);
    const stepCls = 'mb-2 rounded-2xl border border-stone-200 bg-white p-3';
    return (
        <SheetShell title={words.understand} subtitle={title} icon={<PartIcon part={part} />} words={words} onClose={onClose} onBack={onBack} testId={`compare-row-sheet-${activityId}`}>
            <div className={stepCls} data-testid="compare-step-1">
                <b className="block text-[16px] text-stone-900">{n(lang, 1)} · {words.step1}</b>
                <p className="m-0 mt-1 text-[15px] font-semibold text-stone-800">{scheduleNameIn(schedule.name, lang)}</p>
                <p className="m-0 mt-1 text-[15px] font-semibold text-stone-800">{words.step1Line(title, ctx.stageName, item.asked)}</p>
                {item.asked !== null && <div className="mt-1.5"><Dots tone="asked" count={item.asked} /></div>}
            </div>
            <div className={stepCls} data-testid="compare-step-2">
                <b className="block text-[16px] text-stone-900">{n(lang, 2)} · {words.step2}</b>
                {item.done > 0
                    ? <><p className="m-0 mt-1 text-[15px] font-semibold text-stone-800">{stored ? words.step2Records : words.step2CameIn} <b className="text-emerald-800">{n(lang, item.done)}</b></p><div className="mt-1.5"><Dots tone="done" count={item.done} /></div></>
                    : <p className="m-0 mt-1 text-[15px] font-semibold text-stone-800">{words.step2NoRecord(passed)}</p>}
                <p className="m-0 mt-1 text-[14px] font-semibold text-stone-600">{words.step2NoDates}</p>
            </div>
            {lines.length > 0 && (
                <div className={stepCls} data-testid="compare-step-3">
                    <b className="block text-[16px] text-stone-900">{n(lang, 3)} · {words.step3}</b>
                    {lines.map((l, i) => <p key={i} className="m-0 mt-1 text-[15px] font-semibold text-stone-800">{l}</p>)}
                </div>
            )}
            <Note>{words.footerCount}</Note>
        </SheetShell>
    );
};

export const stageLabel = (name: string, lang: CompareLang): string => stageNameIn(name, lang) || name;
