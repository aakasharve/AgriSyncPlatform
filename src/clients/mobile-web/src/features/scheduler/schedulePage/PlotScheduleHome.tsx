/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S3, S5–S8, S12, S15)
 *
 * The शेड्यूल page for ONE plot that follows a real schedule, top to bottom as in the PLR-D8 preview:
 * where you are (crop · plot, who made it, day N of total, the stage line), the 'N days behind' banner, the
 * filled bar with "तुम्ही इथे आहात" and every stage's own bar, then the three big buttons झालं / आज / पुढे
 * and only the chosen list (opens on आज). The preview's "one card per followed schedule" (S4) is the L8b-3 section right under the
 * header (`ThreePlusOneSection`): up to 3 outside schedules and 1 of his own, the मुख्य one marked. The card, the stage line and
 * the tabs below follow the मुख्य schedule (R6).
 * When nobody chose the schedule (the app's first one for the crop), the page says so under the card and
 * offers the library, so its राहिलं lines are not read as misses against a plan he picked.
 */
import React, { useMemo } from 'react';
import type { CropScheduleTemplate } from '../scheduler.types';
import { AheadTab } from './AheadTab';
import { DoneTab } from './DoneTab';
import type { FollowedPlace, ScheduleSource } from './resolveSchedule';
import type { DefaultKind } from '../planning/followableDefault';
import { ThreePlusOneSection } from './ThreePlusOneSection';
import { addDays } from './scheduleDates';
import { LOOK_AHEAD_DAYS, PARTS, aheadItemCount, owedWork, pastDays, stageTally, todayOf, type Part, type ScheduleModel, type Tally } from './scheduleModel';
import { ScheduleTabs, type ScheduleTab } from './ScheduleTabs';
import { TodayTab } from './TodayTab';
import type { ClipsByDay } from './usePlotClips';
import { BehindBanner, DefaultScheduleNote, ScheduleHeader, StageProgress } from './WhereYouAre';
import { TrialStages, trialStageOf } from './TrialStages';
import { StagePlanCard } from './StagePlanCard';
import type { PlotPlanningStateDto } from '../../../infrastructure/api/planningStateDtos';
import type { FollowedCheckNote } from './followedCheck';

export const PlotScheduleHome: React.FC<{
    cropName: string;
    plotName: string;
    template: CropScheduleTemplate;
    source: ScheduleSource;
    model: ScheduleModel;
    clips: ClipsByDay;
    tab: ScheduleTab;
    onTab: (t: ScheduleTab) => void;
    onOpenDay: (key: string) => void;
    onLibrary: () => void;
    /** spec: plr-d10 lane L8b-1F - set when the followed schedule is not checked (a sample) or its check was withdrawn. */
    checkNote?: FollowedCheckNote | null;
    /**
     * spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - every schedule the plot follows, in place order, with the SERVER'S मुख्य one marked;
     * the header, the stage line and the tabs below follow the मुख्य one. The section is drawn when the page is given the doors it needs.
     */
    followed?: readonly FollowedPlace[];
    cropHasChecked?: boolean;
    onAddSchedule?: () => void;
    onLeaveSchedule?: (subscriptionId: string) => void;
    /**
     * spec: plr-d10 lane SCH-GATE-b (D-83 = 1) - "आधी शेड्यूल निवडा", drawn IN FRONT of the page when the server says this plot needs a
     * schedule (it stands in for the "nobody chose" note). `defaultKind` = the default shown is the unchecked sample, and says so.
     */
    ask?: React.ReactNode;
    defaultKind?: DefaultKind;
    /**
     * spec: plr-d10 lane SCH-GATE-b (R10) - set while the server says the plot is in its TRIAL: today's stage (the one the server names) is
     * shown in full and the others by name and days only. `named` is the server's `trialStage` (absent: the phone's own day count).
     */
    trial?: { named: PlotPlanningStateDto['trialStage'] };
    /** spec: plr-d10 lane SCH-GATE-b - the plot this page is about; with it the stage panel (what the schedules ask in this stage) is drawn. */
    plotId?: string;
    /** spec: plr-d10 lane SCH-OWN-b (Q1 = 1) - the live "स्वतःचं शेड्यूल बनवा": drawn only for a seat that may make; it only goes to planning. */
    mayMakeOwn?: boolean;
    onMakeOwn?: () => void;
}> = ({ cropName, plotName, template, source, model, clips, tab, onTab, onOpenDay, onLibrary, checkNote, followed, cropHasChecked = false, onAddSchedule, onLeaveSchedule, ask, defaultKind, trial, plotId, mayMakeOwn, onMakeOwn }) => {
    // R10: in the trial only today's stage is laid open - the पुढे list and tomorrow's line hold only its work.
    const trialStageId = trial ? trialStageOf(model, template, trial.named)?.id ?? null : null;
    const facts = useMemo(() => {
        const total = stageTally(model);
        const byPart = Object.fromEntries(PARTS.map(p => [p, stageTally(model, p)])) as Record<Part, Tally>;
        const owed = owedWork(model);
        const today = todayOf(model);
        const nextDay = model.byKey.get(addDays(model.todayKey, 1));
        const tomorrow = trialStageId && nextDay && nextDay.stageId !== trialStageId ? undefined : nextDay;
        return { total, byPart, owed, today, tomorrow, past: pastDays(model), ahead: aheadItemCount(model, LOOK_AHEAD_DAYS, trialStageId) };
    }, [model, trialStageId]);
    const clipCount = (key: string) => clips.get(key)?.length ?? 0;

    return (
        <div className="space-y-4" data-testid="plot-schedule">
            {ask}
            <ScheduleHeader cropName={cropName} plotName={plotName} template={template} model={model} checkNote={checkNote} onLibrary={onLibrary} />
            {followed && onAddSchedule && onLeaveSchedule && (
                <ThreePlusOneSection followed={followed} cropHasChecked={cropHasChecked} onAdd={onAddSchedule} onLeave={onLeaveSchedule} mayMakeOwn={mayMakeOwn} onMakeOwn={onMakeOwn} />
            )}
            {/* spec: plr-d10 lane SCH-GATE-b (D-99, R10) - the stage panel: after the "3 + 1" section, before the three buttons. */}
            {plotId && <StagePlanCard plotId={plotId} followedKey={(followed ?? []).map(f => f.subscriptionId || f.templateId).join(',')} />}
            {source === 'default' && !ask && <DefaultScheduleNote onLibrary={onLibrary} sample={defaultKind === 'sample'} />}
            <BehindBanner model={model} />
            {trial ? <TrialStages model={model} template={template} named={trial.named} /> : <StageProgress model={model} />}
            <ScheduleTabs tab={tab} onTab={onTab} counts={{
                done: facts.total.done,
                missed: facts.total.missed,
                today: facts.today?.items.length ?? 0,
                owed: facts.owed.length,
                ahead: facts.ahead,
            }} />
            {tab === 'done' && <DoneTab total={facts.total} byPart={facts.byPart} past={facts.past} clipCount={clipCount} onOpenDay={onOpenDay} />}
            {tab === 'today' && <TodayTab owed={facts.owed} today={facts.today} tomorrow={facts.tomorrow} totalDays={model.totalDays} ended={model.ended} onOpenDay={onOpenDay} onSeeAhead={() => onTab('ahead')} />}
            {tab === 'ahead' && <AheadTab model={model} onlyStageId={trialStageId} />}
        </div>
    );
};
