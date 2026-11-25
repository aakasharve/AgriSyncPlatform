/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 4, mobile Schedule Maker; approved spec plr-d10-schedule-approved-spec-2026-11-23: "one question per
 * card: what, when, how, look, ask"; decision 1 "five kinds of work, a separate card for each") - the question cards of ONE work, presentational only: each
 * card reads the draft and hands back a patch. The cards for a kind ask that kind's own "how" (litres of a spray, acres of fertiliser, hours of water,
 * people for farm work, vines to look at), in the farmer's words. Amber = his own schedule; the chips are the planning form's (`PlanChip`, amber tone).
 */
import React from 'react';
import { SCHEDULE_TASK_KINDS, type ScheduleTaskContent, type ScheduleTaskKind } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { PlanChip } from '../../../plannedWork/components/PlanChip';
import { Tap } from '../../../../shared/components/ui/placeUi';
import type { OwnLanguage } from '../ownScheduleWords';
import type { OwnStage } from '../ownScheduleModel';
import { AmberCard, KIND_TONE, Stepper, TextBox } from './makerBits';
import { dayLabel } from './workLine';
import type { RepeatPick, WhenPick, WorkDraft } from './workDraft';
import { MAX_SHOWN_DAY } from './workDraft';
import { SpokenMark } from './SpokenMark';
import type { SpokenMarks } from './spokenTimer';
import type { StartWord, WorkMakerWords } from './workMakerWords';

export interface CardProps {
    draft: WorkDraft;
    set: (patch: Partial<WorkDraft>) => void;
    words: WorkMakerWords;
    language: OwnLanguage;
}

const kindOf = (d: WorkDraft, words: WorkMakerWords) => (d.kind ? { kind: d.kind, label: words.kinds[d.kind] } : null);

export const KindCard: React.FC<CardProps> = ({ draft, set, words }) => (
    <AmberCard testId="own-card-kind" title={words.kindQ}>
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2" role="group" aria-label={words.kindQ}>
            {SCHEDULE_TASK_KINDS.map(k => {
                const on = draft.kind === k;
                return (
                    <Tap key={k} data-testid={`own-kind-${k}`} aria-pressed={on} onClick={() => set({ kind: k })}
                        className={`flex min-h-[52px] items-center gap-2 rounded-2xl border-2 px-3 text-left text-[17px] font-extrabold ${on ? 'border-amber-600 bg-amber-500 text-white' : 'border-stone-200 bg-white text-stone-900'}`}>
                        <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full" style={{ background: KIND_TONE[k][1] }} />
                        {words.kinds[k]}
                    </Tap>
                );
            })}
        </div>
    </AmberCard>
);

export const WhatCard: React.FC<CardProps & { voice: React.ReactNode }> = ({ draft, set, words, voice }) => (
    <AmberCard testId="own-card-what" title={words.whatQ} sub={words.whatSub} kind={kindOf(draft, words)}>
        {voice}
        <TextBox testId="own-work-name" label={words.typeHere} value={draft.name} placeholder={words.namePh} maxLength={200} onChange={v => set({ name: v })} />
        <div className="mt-2 flex flex-wrap gap-2">
            {words.nameChips.map((c, i) => <PlanChip key={c} tone="amber" on={draft.name === c} onClick={() => set({ name: c })} testId={`own-name-chip-${i}`}>{c}</PlanChip>)}
        </div>
    </AmberCard>
);

export const StageCard: React.FC<CardProps & { stages: readonly OwnStage[]; start: StartWord }> = ({ draft, set, words, stages, start }) => {
    if (stages.length === 0) {
        return (
            <AmberCard testId="own-card-stage" title={words.stageQ} kind={kindOf(draft, words)}>
                <p className="m-0 rounded-2xl bg-stone-100 px-3 py-2.5 text-[14px] font-bold leading-snug text-stone-700" data-testid="own-stage-open-note">{words.stageOpenNote}</p>
            </AmberCard>
        );
    }
    const picked = draft.stageIndex !== null ? stages[draft.stageIndex] : undefined;
    return (
        <AmberCard testId="own-card-stage" title={words.stageQ} optional={words.optional} kind={kindOf(draft, words)}>
            <div className="flex flex-col gap-2" role="group" aria-label={words.stageQ}>
                {stages.map((s, i) => (
                    <Tap key={`${s.name}-${i}`} data-testid={`own-stage-${i}`} aria-pressed={draft.stageIndex === i} onClick={() => set({ stageIndex: draft.stageIndex === i ? null : i })}
                        className={`flex min-h-[52px] w-full flex-col justify-center rounded-2xl border-2 px-3 py-1.5 text-left ${draft.stageIndex === i ? 'border-amber-600 bg-amber-50' : 'border-stone-200 bg-white'}`}>
                        <b className="block text-[16px] font-extrabold leading-tight text-stone-900">{s.name}</b>
                        <span className="block text-[13px] font-bold text-stone-600">{words.stageDays(dayLabel(s.startDay, words, start), dayLabel(s.endDay, words, start))}</span>
                    </Tap>
                ))}
                <PlanChip tone="amber" on={draft.stageIndex === null} onClick={() => set({ stageIndex: null })} testId="own-stage-open">{words.stageOpen}</PlanChip>
            </div>
            {/* A stage is a place in the schedule, never the work's day: its days are a hint only (a new work never inherits the stage's first day). */}
            {picked && <p className="m-0 mt-2 text-[13px] font-bold text-amber-900" data-testid="own-stage-hint">{words.stageHint(dayLabel(picked.startDay, words, start), dayLabel(picked.endDay, words, start))}</p>}
        </AmberCard>
    );
};

const WHEN_ORDER: readonly Exclude<WhenPick, 'unset'>[] = ['day', 'after', 'sign', 'later'];
const REPEATS: readonly RepeatPick[] = ['once', 'every_n_days', 'per_week'];

export const WhenCard: React.FC<CardProps & { start: StartWord; anchors: ReadonlyArray<{ key: string; name: string }>; earlyOpen: boolean; openEarly: () => void; spoken?: SpokenMarks | null }> = ({
    draft, set, words, language, start, anchors, earlyOpen, openEarly, spoken,
}) => {
    const step = { language, lessLabel: words.less, moreLabel: words.more } as const;
    const whenLabel: Record<Exclude<WhenPick, 'unset'>, string> = { day: words.whenDay, after: words.whenAfter, sign: words.whenSign, later: words.whenLater };
    const timed = draft.when === 'day' || draft.when === 'after' || draft.when === 'sign';
    return (
        <AmberCard testId="own-card-when" title={words.whenQ} optional={words.optional} kind={kindOf(draft, words)}>
            <div className="flex flex-wrap gap-2" role="group" aria-label={words.whenQ}>
                {WHEN_ORDER.map(w => <PlanChip key={w} tone="amber" on={draft.when === w} onClick={() => set({ when: w })} testId={`own-when-${w}`}>{whenLabel[w]}</PlanChip>)}
            </div>
            {draft.when === 'later' && <p className="m-0 mt-2 text-[13.5px] font-bold text-stone-600" data-testid="own-later-note">{words.laterNote}</p>}
            {draft.when === 'day' && (
                <div data-testid="own-when-day-box">
                    <div className="mt-2 flex flex-wrap gap-2">
                        <PlanChip tone="amber" on={!draft.dayBefore} onClick={() => set({ dayBefore: false })} testId="own-day-side-after">{words.sideAfter(start)}</PlanChip>
                        <PlanChip tone="amber" on={draft.dayBefore} onClick={() => set({ dayBefore: true })} testId="own-day-side-before">{words.sideBefore(start)}</PlanChip>
                    </div>
                    {draft.dayBefore
                        ? <Stepper testId="own-step-before" label={words.beforeDays} unit={words.days} value={draft.beforeDays} min={1} max={MAX_SHOWN_DAY} onChange={n => set({ beforeDays: n })} {...step} />
                        : (
                            <>
                                <Stepper testId="own-step-from" label={words.fromDay(start)} unit={words.days} value={draft.fromShown} min={1} max={MAX_SHOWN_DAY} onChange={n => set({ fromShown: n })} {...step} />
                                {spoken?.from && <SpokenMark testId="own-spoken-from" heard={spoken.heardWords} language={language} />}
                                <Stepper testId="own-step-to" label={words.toDay} unit={words.days} value={draft.toShown} min={draft.fromShown ?? 1} max={MAX_SHOWN_DAY} onChange={n => set({ toShown: n })} {...step} />
                            </>
                        )}
                </div>
            )}
            {draft.when === 'after' && (
                <div data-testid="own-when-after-box">
                    <div className="mt-2 text-[14px] font-extrabold text-stone-700">{words.afterWhich}</div>
                    {anchors.length === 0
                        ? <p className="m-0 mt-1 rounded-2xl bg-stone-100 px-3 py-2 text-[13.5px] font-bold text-stone-700" data-testid="own-after-none">{words.afterNone}</p>
                        : <div className="mt-1 flex flex-wrap gap-2">{anchors.map(a => <PlanChip key={a.key} tone="amber" on={draft.afterKey === a.key} onClick={() => set({ afterKey: a.key })} testId={`own-after-${a.key}`}>{a.name}</PlanChip>)}</div>}
                    {spoken?.afterWork && <SpokenMark testId="own-spoken-after-work" heard={spoken.heardWords} language={language} />}
                    <Stepper testId="own-step-usual" label={words.usualDays} unit={words.days} value={draft.usualDays} min={0} max={MAX_SHOWN_DAY} onChange={n => set({ usualDays: n })} {...step} />
                    {spoken?.afterDays && <SpokenMark testId="own-spoken-after-days" heard={spoken.heardWords} language={language} />}
                    {earlyOpen || draft.earliestDays !== null
                        ? <Stepper testId="own-step-early" label={words.earlyDays} unit={words.days} value={draft.earliestDays} min={0} max={MAX_SHOWN_DAY} onChange={n => set({ earliestDays: n })} {...step} />
                        : <Tap onClick={openEarly} data-testid="own-early-open" className="mt-1 min-h-[48px] rounded-full px-1 text-[15px] font-extrabold text-sky-800 underline underline-offset-2">{words.earlyLink}</Tap>}
                </div>
            )}
            {draft.when === 'sign' && (
                <>
                    <TextBox testId="own-sign-words" label={words.signQ} value={draft.signWords} placeholder={words.signPh} maxLength={1000} onChange={v => set({ signWords: v })} />
                    {spoken?.sign && <SpokenMark testId="own-spoken-sign" heard={spoken.heardWords} language={language} />}
                </>
            )}
            {timed && (
                <div className="mt-3" data-testid="own-repeat-box">
                    <div className="text-[14px] font-extrabold text-stone-700">{words.repeatQ}</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                        {REPEATS.map(r => (
                            <PlanChip key={r} tone="amber" on={draft.repeat === r} testId={`own-repeat-${r}`}
                                onClick={() => set({ repeat: r, repeatN: r === 'once' ? null : r === 'per_week' && draft.repeatN !== null && draft.repeatN > 7 ? null : draft.repeatN })}>
                                {r === 'once' ? words.once : r === 'every_n_days' ? words.everyN : words.perWeek}
                            </PlanChip>
                        ))}
                    </div>
                    {draft.repeat !== 'once' && (
                        <Stepper testId="own-step-repeat" label={draft.repeat === 'per_week' ? words.weekHow : words.everyHow} unit={draft.repeat === 'per_week' ? words.times : words.days}
                            value={draft.repeatN} min={1} max={draft.repeat === 'per_week' ? 7 : MAX_SHOWN_DAY} onChange={n => set({ repeatN: n })} {...step} />
                    )}
                </div>
            )}
        </AmberCard>
    );
};

const usesProduct = (k: ScheduleTaskKind | null): boolean => k === 'spray' || k === 'nutrition';

export const HowCard: React.FC<CardProps> = ({ draft, set, words, language }) => {
    if (!draft.kind) return null;
    const kind = draft.kind;
    const step = { language, lessLabel: words.less, moreLabel: words.more } as const;
    const base: ScheduleTaskContent | null = draft.base;
    const kept = base ? (kind === 'observe' ? base.look?.sample : base.products[0]?.doseAsWritten ?? base.dose) ?? null : null;
    return (
        <AmberCard testId="own-card-how" title={words.howQ} optional={words.optional} kind={kindOf(draft, words)}>
            {usesProduct(kind) && <TextBox testId="own-product" label={words.product} value={draft.product} placeholder={words.productPh} maxLength={200} onChange={v => set({ product: v })} />}
            <Stepper testId="own-step-qty" label={words.qtyQ[kind]} unit={words.qtyUnit[kind]} value={draft.qty} min={1} max={100000} onChange={n => set({ qty: n })} {...step} />
            {kept && draft.qty === null && <p className="m-0 mt-1 text-[13px] font-bold text-stone-600" data-testid="own-qty-kept">{kept}</p>}
            {kind === 'spray' && <Stepper testId="own-step-phi" label={words.phiQ} unit={words.days} value={draft.preHarvestDays} min={0} max={365} onChange={n => set({ preHarvestDays: n })} {...step} />}
            <TextBox testId="own-steps" label={words.stepsQ} value={draft.steps} placeholder={words.stepsPh} multiline maxLength={4000} onChange={v => set({ steps: v })} />
        </AmberCard>
    );
};

export const LookCard: React.FC<CardProps> = ({ draft, set, words }) => (
    <AmberCard testId="own-card-look" title={words.lookQ} optional={words.optional} kind={kindOf(draft, words)}>
        <TextBox testId="own-look" value={draft.lookWords} placeholder={words.lookPh} multiline maxLength={1000} onChange={v => set({ lookWords: v })} />
    </AmberCard>
);

export const AskCard: React.FC<CardProps> = ({ draft, set, words }) => {
    const sign = draft.when === 'sign' ? draft.signWords.trim() : '';
    const suggestion = sign ? words.askSuggest(sign) : null;
    return (
        <AmberCard testId="own-card-ask" title={words.askQ} optional={words.optional} kind={kindOf(draft, words)}>
            {suggestion && <PlanChip tone="amber" on={draft.askWords === suggestion} onClick={() => set({ askWords: suggestion })} testId="own-ask-suggest">{suggestion}</PlanChip>}
            <TextBox testId="own-ask" value={draft.askWords} placeholder={words.askPh} multiline maxLength={1000} onChange={v => set({ askWords: v })} />
        </AmberCard>
    );
};
