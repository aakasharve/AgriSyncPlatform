/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन") - the lines a plan card carries when the plan was made from the
 * farmer's OWN schedule (`task.ownItemId`): "माझ्या शेड्यूलमधून", the waiting state with the day it was expected, and - for a "when seen" work - the question
 * about its sign with three answers (हो, दिसलं / अजून नाही / खात्री नाही), each a 44 px target. An answer is QUEUED (it works with no internet, P10) and the card
 * says it is kept on the phone until the pull brings the moved plan; the server moves the plan, the card never does. The sign's words and the work's place come
 * from this phone's copy of the own work; while that copy is not on the phone the answers wait (disabled) rather than guess a place. Rendered only for a plan
 * with an own work: every other card is exactly as before.
 */
import React from 'react';
import { CalendarClock, Sprout } from 'lucide-react';
import { ScheduleFeedCommands } from '../../../application/usecases/sync/ScheduleFeedCommands';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { ScheduleSignAnswerName } from '../../../infrastructure/storage/plannedWorkRow';
import type { LocalPlannedWork } from '../data/plannedWorkStore';
import { feedDay, scheduleFeedWords } from '../scheduleFeedWords';

const ANSWERS: readonly ScheduleSignAnswerName[] = ['seen', 'not_yet', 'unsure'];

interface OwnWorkFacts {
    cropCycleId: string;
    plotId: string;
    timer: string;
    signWords: string | null;
}

/** This phone's copy of the own work the plan was made from (null while it is not on the phone). */
function useOwnWork(ownItemId: string | null | undefined): OwnWorkFacts | null {
    const [facts, setFacts] = React.useState<OwnWorkFacts | null>(null);
    React.useEffect(() => {
        let alive = true;
        if (!ownItemId) return undefined;
        getDatabase().ownScheduleItems.get(ownItemId)
            .then(row => {
                if (alive && row) {
                    setFacts({ cropCycleId: row.cropCycleId, plotId: row.plotId, timer: row.task.timing.timer, signWords: row.task.timing.signWords ?? null });
                }
            })
            .catch(() => {
                // Not readable on this phone: the answers stay disabled (the place is unknown) and the question is asked without the sign's words.
                if (alive) setFacts(null);
            });
        return () => { alive = false; };
    }, [ownItemId]);
    return facts;
}

export interface ScheduleFeedLinesProps {
    task: LocalPlannedWork;
    language: string | null | undefined;
    /** The farm-local day (YYYY-MM-DD) an answer is given on. */
    today: string;
}

export const ScheduleFeedLines: React.FC<ScheduleFeedLinesProps> = ({ task, language, today }) => {
    const words = scheduleFeedWords(language);
    const work = useOwnWork(task.ownItemId);
    const [kept, setKept] = React.useState<ScheduleSignAnswerName | null>(null);
    if (!task.ownItemId) return null;
    const open = task.status !== 'Done' && task.status !== 'Cancelled';
    const isSign = work?.timer === 'sign' || task.signAnswer != null;
    const waiting = task.waiting === true && open;
    const chosen = kept ?? task.signAnswer ?? null;
    const answer = async (a: ScheduleSignAnswerName) => {
        if (!work || !task.scheduleTaskKey) return;
        await ScheduleFeedCommands.answerSign({ farmId: task.farmId, plotId: work.plotId, cropCycleId: work.cropCycleId }, task.scheduleTaskKey, a, today);
        setKept(a);
    };
    return (
        <div className="mt-1.5" data-testid="plan-card-schedule" data-waiting={waiting ? 'yes' : 'no'}>
            <p className="m-0 inline-flex items-center gap-1 text-[12px] font-extrabold text-emerald-800" data-testid="plan-card-from-schedule">
                <Sprout size={13} aria-hidden="true" />{words.fromMySchedule}
            </p>
            {waiting && (
                <p className="m-0 mt-1 text-[13px] font-bold text-amber-900" data-testid="plan-card-waiting">
                    {isSign ? words.waitingSign : words.waitingAfter}
                </p>
            )}
            {task.expectedFrom && open && (
                <p className="m-0 mt-0.5 flex items-center gap-1 text-[12px] font-bold text-stone-600" data-testid="plan-card-expected">
                    <CalendarClock size={12} aria-hidden="true" />{words.expected(feedDay(task.expectedFrom, language))}
                </p>
            )}
            {isSign && open && (
                <div className="mt-1.5 rounded-xl bg-emerald-50 px-2.5 py-2" data-testid="plan-card-sign">
                    <p className="m-0 text-[14px] font-extrabold text-stone-900" data-testid="plan-card-sign-question">{words.signQuestion(work?.signWords ?? null)}</p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                        {ANSWERS.map(a => (
                            <button key={a} type="button" disabled={!work} onClick={() => { void answer(a); }} data-testid={`plan-card-sign-${a}`}
                                data-chosen={chosen === a ? 'yes' : 'no'}
                                className={`min-h-[44px] min-w-[44px] rounded-full border-2 border-emerald-700 px-4 text-[14px] font-extrabold active:scale-95 disabled:opacity-50 ${chosen === a ? 'bg-emerald-700 text-white' : 'bg-white text-emerald-800'}`}>
                                {words.answer[a]}
                            </button>
                        ))}
                    </div>
                    {kept && <p className="m-0 mt-1.5 text-[12px] font-bold text-sky-900" role="status" data-testid="plan-card-sign-kept">{words.answerKept}</p>}
                    {!kept && task.signAnswer && (
                        <p className="m-0 mt-1.5 text-[12px] font-bold text-stone-600" data-testid="plan-card-sign-last">{words.lastAnswer(words.answer[task.signAnswer])}</p>
                    )}
                </div>
            )}
        </div>
    );
};

export default ScheduleFeedLines;
