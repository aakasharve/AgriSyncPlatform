/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2; founder D-24, D-24c, D-26, D-79, P5, P10) - "कामांचे नियोजन करा" /
 * "तुमच्यावर सोपवलेली कामे", ported from the 25 Oct preview (`postVoiceResult/PlanWork.tsx`) onto the real task record
 * (`features/plannedWork/data`: what the server let THIS person see, plus his unanswered changes).
 *
 *   A PLANNER (the primary owner, or a holder of PlanWork or AssignWork - the door decides, from the server's authorities):
 *     the form, then "ठरलेली कामे" - every task he may see.
 *   EVERYONE ELSE: no form; only the work handed to HIM, with "ठीक आहे, करतो".
 *
 * Opening the list sends `seen` once for each task handed to him that he has not been seen to open (the outbox key makes a second
 * open the same one change). "ठीक आहे, करतो" sends `accept`. "काम झालं" (lane L8c-3, D-24d) opens the normal recording on the task's
 * plot(s) - a reminder of his own is done with no log (D-1) - and the primary owner can reopen a done task with a reason. Every step works with no net and says "फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल" until the server answers; a step the server
 * parked says its own words and opens the conflict page, and never shows as done.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import type { AudioData, CropProfile, FarmerProfile } from '../../../types';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { PlannedWorkAssigneeDto } from '../../../infrastructure/api/plannedWorkDtos';
import { PlannedWorkCommands } from '../data/plannedWorkCommands';
import type { LocalPlannedWork } from '../data/plannedWorkStore';
import { loadAssignees, type AssigneeList } from '../data/plannedWorkAssignees';
import type { PlanSpeechResult } from '../data/planVoice';
import { usePlannedWork } from '../data/usePlannedWork';
import { isOpenTask, isReminderTask } from '../planCardModel';
import { sortByWhen, startOfDay } from '../planDates';
import { plannedWorkWords } from '../plannedWorkWords';
import { PlanCard, fontFor } from './PlanCard';
import { PlanDoneActions } from './PlanDoneActions';
import { PlanForm, type PlanSavedInfo } from './PlanForm';

export interface PlanWorkPageProps {
    farmId: string | null;
    userId: string | null;
    /** Absent = the app's chosen language (the language context). */
    language?: string | null;
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    /** The primary owner or a holder of PlanWork or AssignWork: the form and the whole list. */
    mayPlan: boolean;
    /** The primary owner or a holder of AssignWork: the people are offered. */
    mayAssign: boolean;
    /** Lane L8c-3 - the PRIMARY account holder: the only one who may reopen a done task (the server decides). */
    isPrimaryOwner?: boolean;
    /** Lane L8c-3 - "काम झालं" on handed-out work: opens the recording on the task's plot(s). */
    onStartDone?: (task: LocalPlannedWork) => 'opened' | 'waiting';
    onBack: () => void;
    /** Opens the conflict page (route `offline-conflicts`). */
    onOpenConflicts: () => void;
    /** Injected so the day never looks stale and tests are stable. */
    today?: Date;
    understand?: (audio: AudioData) => Promise<PlanSpeechResult>;
    /** Injected for tests; absent = the server, then the list kept on the phone. */
    loadAssigneeList?: (userId: string, farmId: string) => Promise<AssigneeList>;
}

const NO_ASSIGNEES: readonly PlannedWorkAssigneeDto[] = [];

export const PlanWorkPage: React.FC<PlanWorkPageProps> = ({
    farmId, userId, language: languageProp, crops, farmerProfile, mayPlan, mayAssign, isPrimaryOwner = false, onStartDone, onBack, onOpenConflicts, today: todayProp, understand, loadAssigneeList,
}) => {
    const contextLanguage = useOptionalLanguage()?.language;
    const language = languageProp ?? contextLanguage;
    const words = plannedWorkWords(language);
    const today = useMemo(() => startOfDay(todayProp ?? new Date()), [todayProp]);
    const { items, parked, loaded, reload } = usePlannedWork(farmId);
    const [assignees, setAssignees] = useState<AssigneeList>({ assignees: [], source: 'none', receivedAtUtc: null });
    const [banner, setBanner] = useState<string | null>(null);
    // After a work is saved the form folds away so the new card is right there under the confirmation; one button opens it again.
    const [formOpen, setFormOpen] = useState(true);
    const sentSeen = useRef(new Set<string>());

    // The people he may hand work to: the server's list, kept on the phone for the times there is no net.
    useEffect(() => {
        if (!mayPlan || !mayAssign || !farmId || !userId) return;
        let live = true;
        void (loadAssigneeList ?? loadAssignees)(userId, farmId).then(list => { if (live) setAssignees(list); });
        return () => { live = false; };
    }, [mayPlan, mayAssign, farmId, userId, loadAssigneeList]);

    // Opening the list: "पाहिलं" once for each task handed to him. The outbox key (`plannedwork.seen:<id>`) makes a repeat the same change.
    useEffect(() => {
        if (!loaded || !farmId || !userId) return;
        const fresh = items.filter(t => t.assigneeUserId === userId && !isReminderTask(t, userId) && t.status === 'Assigned' && !t.refused
            && !t.pendingSteps.includes('seen') && !parked.has(t.id) && !sentSeen.current.has(t.id));
        if (fresh.length === 0) return;
        fresh.forEach(t => sentSeen.current.add(t.id));
        void Promise.all(fresh.map(t => PlannedWorkCommands.seen(t.id, farmId))).then(() => reload()).catch(() => undefined);
    }, [loaded, items, parked, farmId, userId, reload]);

    const nameOf = useCallback((id: string | null): { name: string | null; role: string | null } => {
        const found = id ? assignees.assignees.find(a => a.userId === id) : undefined;
        return { name: found?.displayName ?? null, role: found?.role ?? null };
    }, [assignees.assignees]);

    const plotName = useMemo(() => {
        const map = new Map<string, string>();
        crops.forEach(c => c.plots.forEach(p => map.set(p.id, p.name)));
        return map;
    }, [crops]);
    const whereOf = (task: LocalPlannedWork): string => {
        if (task.scope === 'Farm' || task.scope === 'Unspecified') return words.scope[task.scope];
        const named = task.plotIds.map(id => plotName.get(id)).filter((n): n is string => !!n);
        return named.length > 0 ? named.join(', ') : words.scope[task.scope];
    };

    const accept = async (task: LocalPlannedWork) => {
        if (!farmId) return;
        await PlannedWorkCommands.accept(task.id, farmId);
        await reload();
    };

    const shown = useMemo(() => {
        const visible = mayPlan ? items : items.filter(t => t.assigneeUserId !== null && t.assigneeUserId === userId && !isReminderTask(t, userId));
        const open = sortByWhen(visible.filter(isOpenTask));
        return [...open, ...sortByWhen(visible.filter(t => !isOpenTask(t)))];
    }, [items, mayPlan, userId]);

    const saved = (info: PlanSavedInfo) => {
        setBanner(info.reminder || !info.assignedTo ? words.remindedDone : words.assignedDone(info.assignedTo));
        setFormOpen(false);
        void reload();
    };

    return (
        <div className="space-y-3 px-3 pb-6 pt-3" style={{ fontFamily: fontFor(language) }} data-testid="plan-work" data-can-plan={mayPlan ? 'yes' : 'no'}>
            <div className="flex items-center gap-2">
                <button type="button" onClick={onBack} data-testid="plan-back" aria-label={words.back}
                    className="inline-flex min-h-[52px] shrink-0 items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-md active:scale-95">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} aria-hidden="true" /></span>
                    <span className="text-[17px] font-extrabold">{words.back}</span>
                </button>
                <h3 className="m-0 min-w-0 flex-1 text-[20px] font-extrabold leading-tight text-stone-900" data-testid="plan-title">{mayPlan ? words.planTitle : words.mineTitle}</h3>
            </div>

            {banner && <div role="status" data-testid="plan-banner" className="rounded-2xl border-2 border-emerald-600 bg-emerald-50 p-3 text-[15px] font-extrabold text-emerald-900">{banner}</div>}

            {mayPlan && farmId && (
                <>
                    {!formOpen && (
                        <button type="button" onClick={() => { setFormOpen(true); setBanner(null); }} data-testid="plan-new"
                            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-[#1448E6] bg-white text-[18px] font-extrabold text-[#1448E6] active:scale-[0.98]">
                            <Plus size={22} strokeWidth={3} aria-hidden="true" />{words.moreWork}
                        </button>
                    )}
                    {formOpen && (
                        <PlanForm farmId={farmId} userId={userId} language={language} crops={crops} farmerProfile={farmerProfile}
                            mayAssign={mayAssign} assignees={mayAssign ? assignees.assignees : NO_ASSIGNEES} assigneesFromCache={assignees.source === 'cache'}
                            today={today} understand={understand} onSaved={saved} />
                    )}
                </>
            )}

            <section data-testid={mayPlan ? 'plan-list' : 'plan-mine'}>
                {mayPlan && <h4 className="m-0 mb-2 text-[17px] font-extrabold text-stone-800">{words.list} <span className="text-[13px] font-bold text-stone-600">({shown.length})</span></h4>}
                {shown.length === 0 && <p className="m-0 text-[14px] font-semibold text-stone-600" data-testid="plan-empty">{mayPlan ? words.empty : words.emptyMine}</p>}
                <ul className="m-0 space-y-2 p-0">
                    {shown.map(task => {
                        const who = nameOf(task.assigneeUserId);
                        const parkedStep = parked.get(task.id);
                        const mine = task.assigneeUserId !== null && task.assigneeUserId === userId;
                        const canAccept = mine && !task.refused && !isReminderTask(task, userId) && (task.status === 'Assigned' || task.status === 'Seen')
                            && !task.pendingSteps.includes('accept') && !(parkedStep && parkedStep.verb === 'accept');
                        return (
                            <PlanCard key={task.id} task={task} today={today} me={userId} language={language} whereText={whereOf(task)}
                                assigneeName={who.name} assigneeRole={who.role}
                                makerName={task.createdByUserId && task.createdByUserId === userId ? words.you : nameOf(task.createdByUserId).name}
                                parked={parkedStep} onOpenConflicts={onOpenConflicts} plotNames={plotName}
                                actions={(
                                    <>
                                        {canAccept && (
                                            <button type="button" data-testid={`plan-accept-${task.id}`} onClick={() => { void accept(task); }}
                                                className="min-h-[48px] rounded-full bg-[#1448E6] px-5 text-[15px] font-extrabold text-white active:scale-95">{words.accept}</button>
                                        )}
                                        <PlanDoneActions task={task} me={userId} words={words} isPrimaryOwner={isPrimaryOwner} parked={parkedStep}
                                            onStartDone={onStartDone} onQueued={() => { void reload(); }} onNote={setBanner} />
                                    </>
                                )} />
                        );
                    })}
                </ul>
            </section>
        </div>
    );
};

export default PlanWorkPage;
