/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year"; approved spec plr-d10-schedule-approved-spec-2026-11-23, decision 3; SM-13;
 * P3, P4, P8, P10) - the season-end review, the design's scene "5. My schedule" as a full screen: each own work as a card with "मूळ: <origin> · मालक: तुम्ही", for each
 * work a card "<work>: पुढच्या वर्षी?" with the chip "हंगामाच्या शेवटी" and its options, and the closing card "हेच माझं शेड्यूल".
 *   - done as written: pre-selected "शेड्यूलप्रमाणे", changeable; done differently: nothing pre-selected, BOTH values shown with their sources; no record: only
 *     "शेड्यूलप्रमाणे" / "नको" (never "not done"); work only planned: listed apart, carried only if picked;
 *   - finishing with questions left unanswered never refuses (P8): the closing card names how many will be carried as scheduled;
 *   - one tap on the closing card queues ONE `ownschedule.carry_forward` (offline first); the review is asked once and never pops again.
 */
import React, { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { OwnScheduleCommands } from '../../../application/usecases/sync/OwnScheduleCommands';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { Tap } from '../../../shared/components/ui/placeUi';
import type { OwnLanguage } from './ownScheduleWords';
import {
    answersOf, choicesOf, type CarryChoice, type CarryRow, type ReviewQuestion, type SeasonReviewModel,
} from './seasonReviewModel';
import { SEASON_REVIEW_WORDS } from './seasonReviewWords';

export interface SeasonReviewProps {
    farmId: string;
    plotId: string;
    plotName: string;
    fromCropCycleId: string;
    toCropCycleId: string;
    model: SeasonReviewModel;
    originNames: Readonly<Record<string, string | null>>;
    language: OwnLanguage;
    onBack: () => void;
    /** The answers were handed to the outbox. */
    onFinished?: () => void;
}

const optionClass = (on: boolean) =>
    `min-h-[52px] w-full rounded-2xl border-2 px-3 text-[16px] font-extrabold ${on ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-stone-300 bg-white text-stone-900'}`;

export const SeasonReview: React.FC<SeasonReviewProps> = ({
    farmId, plotId, plotName, fromCropCycleId, toCropCycleId, model, originNames, language, onBack, onFinished,
}) => {
    const words = SEASON_REVIEW_WORDS[language];
    const [chosen, setChosen] = useState<ReadonlyMap<string, CarryChoice>>(
        () => new Map(model.questions.filter(q => q.preselected).map(q => [q.taskKey, q.preselected as CarryChoice])),
    );
    const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [queued, setQueued] = useState(false);
    const unanswered = useMemo(() => model.questions.filter(q => !chosen.has(q.taskKey)), [model.questions, chosen]);

    const choose = (key: string, choice: CarryChoice) => setChosen(prev => new Map(prev).set(key, choice));
    const togglePlanOnly = (key: string) => setPicked(prev => {
        const next = new Set(prev);
        if (!next.delete(key)) next.add(key);
        return next;
    });

    const finish = async () => {
        if (busy || queued) return;
        setBusy(true);
        try {
            await OwnScheduleCommands.carryForward({ farmId, plotId, fromCropCycleId, toCropCycleId }, answersOf(chosen, model.questions), [...picked]);
            setQueued(true);
            backgroundSyncWorker.triggerNow().catch(() => undefined);
            onFinished?.();
        } finally {
            setBusy(false);
        }
    };

    const dayWords = (q: ReviewQuestion) => (q.expectedFrom === null ? null : words.expectedLine(q.expectedFrom, q.expectedTo));

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-50" data-testid="season-review" role="dialog" aria-label={words.title}>
            <div className="mx-auto max-w-[480px] space-y-3 px-3.5 pb-28 pt-3">
                <div className="flex items-center gap-2">
                    <Tap onClick={onBack} data-testid="season-review-back" aria-label={words.back} className="grid min-h-[48px] min-w-[48px] place-items-center rounded-full bg-white ring-1 ring-stone-300">
                        <ArrowLeft size={22} aria-hidden="true" />
                    </Tap>
                    <div className="min-w-0">
                        <h2 className="m-0 text-[20px] font-extrabold leading-tight text-stone-900">{words.title}</h2>
                        <p className="m-0 text-[13.5px] font-bold text-stone-600">{plotName}</p>
                    </div>
                </div>

                {model.questions.map(q => {
                    const mine = chosen.get(q.taskKey) ?? null;
                    return (
                        <section key={q.taskKey} className="space-y-2 rounded-3xl bg-white p-3.5 ring-1 ring-stone-200" data-testid={`season-q-${q.taskKey}`} data-kind={q.kind}>
                            <b className="block text-[17px] font-extrabold leading-tight text-stone-900">{q.task.name}</b>
                            <span className="block text-[13px] font-bold text-stone-600" data-testid={`season-origin-${q.taskKey}`}>{words.originLine(originNames[q.taskKey] ?? null)}</span>
                            <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-[13px] font-extrabold text-amber-900">{words.chip}</span>
                            <p className="m-0 text-[18px] font-extrabold leading-tight text-stone-900">{words.askLine(q.task.name)}</p>
                            {q.kind !== 'none' && (
                                <div className="space-y-1 rounded-2xl bg-stone-50 px-3 py-2 text-[14px] font-bold text-stone-800" data-testid={`season-values-${q.taskKey}`}>
                                    {dayWords(q) && <p className="m-0">{dayWords(q)} <span className="text-stone-600">· {words.sourceOwn}</span></p>}
                                    {q.recordedDay !== null && q.recordedOn && <p className="m-0">{words.recordedLine(q.recordedDay, q.recordedOn)} <span className="text-stone-600">· {words.sourceRecord}</span></p>}
                                    {q.part && <p className="m-0">{words.partLine}</p>}
                                </div>
                            )}
                            {q.kind === 'none' && <p className="m-0 text-[14px] font-bold text-stone-700" data-testid={`season-norecord-${q.taskKey}`}>{words.noRecordLine}</p>}
                            <div className="flex flex-col gap-2" role="radiogroup" aria-label={words.askLine(q.task.name)}>
                                {choicesOf(q).map(c => (
                                    <Tap key={c} role="radio" aria-checked={mine === c} onClick={() => choose(q.taskKey, c)}
                                        data-testid={`season-opt-${q.taskKey}-${c}`} data-on={mine === c ? 'true' : 'false'} className={optionClass(mine === c)}>
                                        {c === 'schedule' ? words.scheduleLabel : c === 'mine' ? words.mineLabel : words.skipLabel}
                                    </Tap>
                                ))}
                            </div>
                        </section>
                    );
                })}

                {model.planOnly.length > 0 && (
                    <section className="space-y-2 rounded-3xl border-2 border-stone-300 bg-stone-100 p-3.5" data-testid="season-planonly">
                        <b className="block text-[17px] font-extrabold text-stone-900">{words.planOnlyTitle}</b>
                        <p className="m-0 text-[13.5px] font-bold text-stone-700">{words.planOnlySub}</p>
                        {model.planOnly.map(w => (
                            <div key={w.taskKey} className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2">
                                <span className="min-w-0 flex-1 text-[16px] font-extrabold text-stone-900">{w.name}</span>
                                <Tap role="checkbox" aria-checked={picked.has(w.taskKey)} onClick={() => togglePlanOnly(w.taskKey)}
                                    data-testid={`season-planonly-${w.taskKey}`} data-on={picked.has(w.taskKey) ? 'true' : 'false'}
                                    className={`${optionClass(picked.has(w.taskKey))} !w-auto flex-none`}>{words.planOnlyTake}</Tap>
                            </div>
                        ))}
                    </section>
                )}

                <section className="space-y-2 rounded-3xl bg-emerald-50 p-3.5 ring-1 ring-emerald-300" data-testid="season-close">
                    <b className="block text-[19px] font-extrabold text-emerald-950">{words.closeTitle}</b>
                    <p className="m-0 text-[14px] font-bold text-emerald-900">{words.closeSub}</p>
                    {unanswered.length > 0 && (
                        <p className="m-0 rounded-2xl bg-white px-3 py-2 text-[14px] font-bold text-stone-800" data-testid="season-kept-note">
                            {words.keptTitle(unanswered.length)}. {words.keptNote}
                            <span className="mt-1 block text-[13px] text-stone-600">{unanswered.map(q => q.task.name).join(' · ')}</span>
                        </p>
                    )}
                    {queued && <p role="status" className="m-0 text-[14px] font-extrabold text-emerald-900" data-testid="season-queued">{words.queued}</p>}
                    <Tap onClick={() => { void finish(); }} disabled={busy || queued} data-testid="season-finish"
                        className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-emerald-700 text-[18px] font-extrabold text-white disabled:opacity-60">{words.finish}</Tap>
                </section>
            </div>
        </div>
    );
};

/** A read-only look at the answers the server kept (the review never pops again; it stays reachable). */
export const SeasonReviewRead: React.FC<{ rows: readonly CarryRow[]; names: Readonly<Record<string, string>>; language: OwnLanguage; onBack: () => void }> = ({ rows, names, language, onBack }) => {
    const words = SEASON_REVIEW_WORDS[language];
    return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-50" data-testid="season-review-read" role="dialog" aria-label={words.readTitle}>
            <div className="mx-auto max-w-[480px] space-y-2 px-3.5 pb-16 pt-3">
                <div className="flex items-center gap-2">
                    <Tap onClick={onBack} data-testid="season-read-back" aria-label={words.back} className="grid min-h-[48px] min-w-[48px] place-items-center rounded-full bg-white ring-1 ring-stone-300">
                        <ArrowLeft size={22} aria-hidden="true" />
                    </Tap>
                    <h2 className="m-0 text-[20px] font-extrabold text-stone-900">{words.readTitle}</h2>
                </div>
                {rows.map(r => (
                    <div key={r.taskKey} className="rounded-2xl bg-white px-3 py-2 ring-1 ring-stone-200" data-testid={`season-read-${r.taskKey}`}>
                        <b className="block text-[16px] font-extrabold text-stone-900">{names[r.taskKey] ?? r.taskKey}</b>
                        <span className="block text-[14px] font-bold text-stone-700">{words.choiceWords[(r.choice as keyof typeof words.choiceWords)] ?? r.choice}</span>
                        {!r.answered && <span className="block text-[13px] font-bold text-stone-600">{words.readKept}</span>}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SeasonReview;
