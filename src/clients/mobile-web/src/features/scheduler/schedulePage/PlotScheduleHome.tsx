/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S3, S5–S8, S12, S15)
 *
 * The शेड्यूल page for ONE plot that follows a real schedule, top to bottom as in the PLR-D8 preview:
 * where you are (crop · plot, who made it, day N of total, the stage line), the 'N days behind' banner, the
 * filled bar with "तुम्ही इथे आहात" and every stage's own bar, then the three big buttons झालं / आज / पुढे
 * and only the chosen list (opens on आज). The preview's "one card per followed schedule" (S4) is not here:
 * a plot follows one schedule today, and that schedule is already named on the card above.
 * When nobody chose the schedule (the app's first one for the crop), the page says so under the card and
 * offers the library, so its राहिलं lines are not read as misses against a plan he picked.
 */
import React, { useMemo } from 'react';
import type { CropScheduleTemplate } from '../scheduler.types';
import { AheadTab } from './AheadTab';
import { DoneTab } from './DoneTab';
import type { ScheduleSource } from './resolveSchedule';
import { addDays } from './scheduleDates';
import { LOOK_AHEAD_DAYS, PARTS, aheadItemCount, owedWork, pastDays, stageTally, todayOf, type Part, type ScheduleModel, type Tally } from './scheduleModel';
import { ScheduleTabs, type ScheduleTab } from './ScheduleTabs';
import { TodayTab } from './TodayTab';
import type { ClipsByDay } from './usePlotClips';
import { BehindBanner, DefaultScheduleNote, ScheduleHeader, StageProgress } from './WhereYouAre';
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
}> = ({ cropName, plotName, template, source, model, clips, tab, onTab, onOpenDay, onLibrary, checkNote }) => {
    const facts = useMemo(() => {
        const total = stageTally(model);
        const byPart = Object.fromEntries(PARTS.map(p => [p, stageTally(model, p)])) as Record<Part, Tally>;
        const owed = owedWork(model);
        const today = todayOf(model);
        const tomorrow = model.byKey.get(addDays(model.todayKey, 1));
        return { total, byPart, owed, today, tomorrow, past: pastDays(model), ahead: aheadItemCount(model, LOOK_AHEAD_DAYS) };
    }, [model]);
    const clipCount = (key: string) => clips.get(key)?.length ?? 0;

    return (
        <div className="space-y-4" data-testid="plot-schedule">
            <ScheduleHeader cropName={cropName} plotName={plotName} template={template} model={model} checkNote={checkNote} onLibrary={onLibrary} />
            {source === 'default' && <DefaultScheduleNote onLibrary={onLibrary} />}
            <BehindBanner model={model} />
            <StageProgress model={model} />
            <ScheduleTabs tab={tab} onTab={onTab} counts={{
                done: facts.total.done,
                missed: facts.total.missed,
                today: facts.today?.items.length ?? 0,
                owed: facts.owed.length,
                ahead: facts.ahead,
            }} />
            {tab === 'done' && <DoneTab total={facts.total} byPart={facts.byPart} past={facts.past} clipCount={clipCount} onOpenDay={onOpenDay} />}
            {tab === 'today' && <TodayTab owed={facts.owed} today={facts.today} tomorrow={facts.tomorrow} totalDays={model.totalDays} ended={model.ended} onOpenDay={onOpenDay} onSeeAhead={() => onTab('ahead')} />}
            {tab === 'ahead' && <AheadTab model={model} />}
        </div>
    );
};
