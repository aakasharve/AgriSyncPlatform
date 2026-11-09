/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 4; R10, D-76 "experience one stage, not the entire schedule")
 *
 * The stage list while the plot is in its TRIAL (the server says so: `plotPlanningState.inTrial`). It stands in for the stage ribbon:
 *   - TODAY'S stage is the one the SERVER names (`trialStage`: its name, else its days; the phone's own day count only when the server
 *     names none) - shown in full, with "आजची स्टेज — वर पूर्ण दिसते"; its work is the stage panel above and the आज / पुढे lists below;
 *   - every other stage shows its NAME AND DAYS ONLY, greyed - no bar, no tick, no progress;
 *   - one line says it is ShramSafal's rule for the trial (R10), so nothing reads as a fault. Nothing here says a record is held back.
 * Words: `scheduleGateCopy` (Marathi mode Marathi only, English mode English only); stage names in Marathi are the app's one table.
 */
import React from 'react';
import { Layers } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { PlotPlanningStateDto } from '../../../infrastructure/api/planningStateDtos';
import { SCHEDULE_GATE_WORDS, type GateLanguage } from './scheduleGateCopy';
import type { CropScheduleTemplate } from '../scheduler.types';
import type { ScheduleModel, StageView } from './scheduleModel';
import { GLASS } from './scheduleUi';

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

type StageNames = Pick<CropScheduleTemplate, 'stages'>;

/** The stage's name as the schedule wrote it (the model's own `name` is already said in Marathi). */
const rawName = (template: StageNames, stage: StageView): string => template.stages.find(t => t.id === stage.id)?.name ?? stage.name;

/**
 * The phone's stage that is today's in the trial. The server's word first: the stage it names (by the name the schedule wrote, else by
 * the same days); only when it names none, or none of the phone's stages is that one, the stage the phone's own day count puts today in.
 */
export function trialStageOf(model: Pick<ScheduleModel, 'stages' | 'currentStage'>, template: StageNames, named: PlotPlanningStateDto['trialStage'] | undefined): StageView | null {
    if (named) {
        const byName = model.stages.find(s => sameName(rawName(template, s), named.name));
        if (byName) return byName;
        const byDays = model.stages.find(s => s.from === named.startDay && s.to === named.endDay);
        if (byDays) return byDays;
    }
    return model.currentStage;
}

export const TrialStages: React.FC<{ model: Pick<ScheduleModel, 'stages' | 'currentStage'>; template: StageNames; named: PlotPlanningStateDto['trialStage'] | undefined }> = ({ model, template, named }) => {
    const language: GateLanguage = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words = SCHEDULE_GATE_WORDS[language];
    const today = trialStageOf(model, template, named);
    if (model.stages.length === 0) return null;
    return (
        <section className={`rounded-3xl p-5 ${GLASS}`} data-testid="trial-stages" data-language={language}>
            <div className="mb-2 flex items-center gap-2">
                <Layers size={22} className="text-indigo-500" aria-hidden="true" />
                <h3 className="m-0 text-[20px] font-black text-stone-900" data-testid="trial-heading">{words.trialHeading}</h3>
            </div>
            <p className="m-0 mb-3 text-[15px] font-bold leading-snug text-stone-700" data-testid="trial-rule">{words.trialRule}</p>
            <ol className="m-0 list-none space-y-2 p-0">
                {model.stages.map(s => {
                    const isToday = today?.id === s.id;
                    const name = language === 'mr' ? s.name : rawName(template, s);
                    return (
                        <li key={s.id} data-testid={`trial-stage-${s.index + 1}`} data-today={isToday ? 'yes' : 'no'} data-greyed={isToday ? 'no' : 'yes'}
                            className={`rounded-2xl px-3 py-2.5 ${isToday ? 'border-2 border-emerald-300 bg-emerald-50/80' : 'border border-stone-200 bg-stone-100/70 opacity-70'}`}>
                            <span className={`block text-[18px] font-extrabold leading-snug ${isToday ? 'text-emerald-900' : 'text-stone-500'}`}>{name}</span>
                            <span className={`block text-[14px] font-bold ${isToday ? 'text-stone-700' : 'text-stone-500'}`}>{words.dayRange(s.from, s.to)}</span>
                            {isToday && <span className="mt-1 block text-[14px] font-extrabold text-emerald-800">{words.trialToday}</span>}
                        </li>
                    );
                })}
            </ol>
        </section>
    );
};
