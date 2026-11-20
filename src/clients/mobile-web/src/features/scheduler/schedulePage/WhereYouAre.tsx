/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S3, S15)
 *
 * "Where you are", in the preview's look (then the filled bar with the "तुम्ही इथे आहात" pin and EVERY stage by name
 * with its own bar). Inside the page bar that already says "शेड्यूल", the header names the crop and plot, then the
 * OWNER BAR (lane UI-8, founder D-148/D-150: a slim white card - it was a black one - with the maker's picture, the real
 * name it was saved with and its lineage, S15), the three numbers and the stage line. Every number is the real schedule's; a missing one is
 * "—" (P4). The schedule's name is shown in Marathi for the schedules the app ships (`scheduleNameMr`);
 * a name a person wrote is shown as written. "तुम्ही इथे आहात" marks a stage only while today is in it.
 */
import React from 'react';
import { Info, Layers, Pin } from 'lucide-react';
import { CategoryIcon } from '../../logs/components/shramsathi/understandingRing/CategoryIcon';
import { Tap } from '../../../shared/components/ui/placeUi';
import type { CropScheduleTemplate } from '../scheduler.types';
import { SC, mrNum } from './scheduleCopy';
import type { ScheduleModel } from './scheduleModel';
import { GLASS } from './scheduleUi';
import type { FollowedCheckNote } from './followedCheck';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { SCHEDULE_GATE_WORDS } from './scheduleGateCopy';
import { ScheduleOwnerBar } from './ScheduleOwnerBar';

/**
 * spec: plr-d10 lane L8b-1F (R7, R8) - under the card of a schedule ShramSafal's check does not stand behind: the withdrawn
 * words with the checker's reason, and the way to take the newer checked schedule when the crop has one.
 */
export const FollowedCheckNoteLine: React.FC<{ note: FollowedCheckNote; onLibrary?: () => void; tone?: 'dark' | 'light' }> = ({ note, onLibrary, tone = 'dark' }) => (
    <div className="mt-2 space-y-1.5" data-testid="followed-check-note" data-kind={note.kind}>
        {note.kind === 'withdrawn' && <p className={`m-0 text-[15px] font-extrabold ${tone === 'light' ? 'text-amber-800' : 'text-amber-200'}`} data-testid="followed-withdrawn">{SC.checkWithdrawn(note.reason)}</p>}
        {note.offerNew && onLibrary && (
            <Tap onClick={onLibrary} data-testid="followed-take-new"
                className={`flex min-h-[48px] w-full items-center justify-center rounded-full border-2 px-4 text-[16px] font-extrabold ${tone === 'light' ? 'border-emerald-600 bg-white text-emerald-800' : 'border-emerald-300 bg-white/10 text-white'}`}>
                {SC.takeNewChecked} →
            </Tap>
        )}
    </div>
);

export const ScheduleHeader: React.FC<{ cropName: string; plotName: string; template: CropScheduleTemplate; model: ScheduleModel; checkNote?: FollowedCheckNote | null; onLibrary?: () => void; ownerImageUrl?: string | null }> = ({ cropName, plotName, template, model, checkNote, onLibrary, ownerImageUrl = null }) => {
    const stage = model.currentStage;
    const started = model.todayDay >= 0;
    const tiles: ReadonlyArray<readonly [string, string, string]> = [
        [started ? mrNum(model.todayDay) : '—', SC.dayNow, 'day-now'],
        [model.totalDays !== null ? mrNum(model.totalDays) : '—', SC.dayTotal, 'day-total'],
        [mrNum(model.stages.length), SC.stageCount, 'stage-count'],
    ];
    // UI-8 (D-148 layout C, D-150): which plot this is, then the WHITE owner bar (the maker's picture place, real name, schedule name), the three
    // numbers as white tiles and the stage line. Same facts as the old black card; only the look and the order of the first lines changed.
    return (
        <section className="space-y-2.5" data-testid="sched-header">
            <h2 className="m-0 px-1 text-[20px] font-black leading-tight tracking-tight text-stone-900" data-testid="sched-crop-plot">{cropName} · {plotName}</h2>
            <ScheduleOwnerBar template={template} imageUrl={ownerImageUrl}>
                {checkNote && <FollowedCheckNoteLine note={checkNote} onLibrary={onLibrary} tone="light" />}
            </ScheduleOwnerBar>
            <div className="grid grid-cols-3 gap-1.5">
                {tiles.map(([n, label, id]) => (
                    <div key={id} className="rounded-xl border border-stone-200 bg-white px-1 py-1.5 text-center">
                        <div className="text-[22px] font-black leading-none text-stone-900" data-testid={id}>{n}</div>
                        <div className="mt-1 text-[12.5px] font-bold text-stone-600">{label}</div>
                    </div>
                ))}
            </div>
            {!started && <p className="m-0 text-[15px] font-bold text-amber-800" data-testid="not-started">{SC.notStarted(-model.todayDay)}</p>}
            {model.ended && <p className="m-0 text-[15px] font-bold text-amber-800" data-testid="sched-ended">{SC.ended}</p>}
            {stage && (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2">
                    <CategoryIcon name="sprout" size={22} className="shrink-0" />
                    <span className="text-[16px] font-black leading-snug text-emerald-800" data-testid="stage-line">
                        {SC.stage} {mrNum(stage.index + 1)} · {stage.name} <span className="text-[14px] font-bold text-emerald-700">({SC.dayN(stage.from)}–{mrNum(stage.to)})</span>
                    </span>
                </div>
            )}
        </section>
    );
};

export const StageProgress: React.FC<{ model: ScheduleModel }> = ({ model }) => {
    const pct = model.progressPct;
    if (model.stages.length === 0) return null;
    return (
        <section className={`rounded-3xl p-5 ${GLASS}`} data-testid="stage-ribbon">
            <div className="mb-3 flex items-center gap-2">
                <Layers size={22} className="text-indigo-500" aria-hidden="true" />
                <h3 className="m-0 text-[20px] font-black text-stone-900">{SC.progress}</h3>
                <span className="ml-auto text-[18px] font-black text-emerald-700" data-testid="progress-pct">{pct === null ? '—' : `${mrNum(pct)}%`}</span>
            </div>
            {pct !== null && (
                <div className={`relative ${model.todayDay >= 0 ? 'pt-9' : ''}`}>
                    {/* Before day 0 nobody is anywhere on the schedule yet: no pin. */}
                    {model.todayDay >= 0 && (
                        <span className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${Math.min(88, Math.max(12, pct))}%` }} data-testid="here-pin">
                            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#1448E6] px-3 py-1 text-[14px] font-extrabold text-white shadow"><Pin size={14} aria-hidden="true" />{SC.here}</span>
                            <span className="h-2 w-0.5 bg-[#1448E6]" />
                        </span>
                    )}
                    <div className="relative h-4 overflow-hidden rounded-full bg-stone-200" data-testid="overall-bar" data-pct={pct}>
                        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${pct}%` }} />
                    </div>
                </div>
            )}
            <ol className="m-0 mt-4 list-none space-y-2 p-0">
                {model.stages.map(s => (
                    <li key={s.id} data-testid={`stage-row-${s.index + 1}`} data-current={s.current ? 'yes' : 'no'} className={`rounded-2xl px-3 py-2.5 ${s.current ? 'border-2 border-emerald-300 bg-emerald-50/80' : 'border border-transparent'}`}>
                        <div className="flex items-center gap-3">
                            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[16px] font-black ${s.current ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30' : s.past ? 'bg-emerald-600 text-white' : 'bg-stone-200 text-stone-500'}`}>{s.past ? '✓' : mrNum(s.index + 1)}</span>
                            <span className="min-w-0 flex-1">
                                <span className={`block text-[18px] font-extrabold leading-snug ${s.current ? 'text-emerald-900' : s.past ? 'text-stone-700' : 'text-stone-500'}`}>{s.name}</span>
                                <span className="block text-[14px] font-bold text-stone-600">{SC.dayN(s.from)}–{mrNum(s.to)}</span>
                            </span>
                            {s.current && <span className="shrink-0 rounded-full bg-[#1448E6] px-2.5 py-1 text-[13px] font-extrabold text-white">{SC.here}</span>}
                        </div>
                        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-stone-200" data-testid={`ribbon-${s.index + 1}`} data-filled={s.filledPct}>
                            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${s.filledPct}%` }} />
                        </div>
                    </li>
                ))}
            </ol>
        </section>
    );
};

/**
 * Nobody chose this schedule: it is the app's default for the crop. Said plainly, with the way to choose.
 * spec: plr-d10 lane SCH-GATE-b - `sample` = the default is the unchecked SAMPLE of a crop with no checked schedule: it says so (D-91 = 1).
 */
export const DefaultScheduleNote: React.FC<{ onLibrary: () => void; sample?: boolean }> = ({ onLibrary, sample = false }) => (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3" data-testid="default-schedule-note">
        <p className="m-0 text-[16px] font-extrabold text-amber-950">{SC.defaultSchedule}</p>
        {sample && <SampleMark />}
        <Tap onClick={onLibrary} data-testid="default-schedule-library"
            className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-full border-2 border-amber-600 bg-white px-4 text-[16px] font-extrabold text-amber-900">
            {SC.chooseSchedule} →
        </Tap>
    </div>
);

const SampleMark: React.FC = () => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    return <p className="m-0 mt-1 text-[15px] font-extrabold text-amber-950" data-testid="default-schedule-sample">{SCHEDULE_GATE_WORDS[language].sampleMark}</p>;
};

/**
 * The kept 'N days behind' banner, in Marathi. Counted by the page's own rule (V2-06), so it can never give
 * another day number than the card above or the editor: the crop's day is the card's "आजचा दिवस" (from the
 * schedule's day 0, less the recorded shifts) and the calendar day is that plus the shifts. The old page's
 * banner counted 1-based from the plot's first start date, so it said "पिकासाठी दिवस 8" beside a card saying
 * 7, and kept counting from the old date after the editor moved day 0.
 */
export const BehindBanner: React.FC<{ model: Pick<ScheduleModel, 'todayDay' | 'lossDays'> }> = ({ model }) => {
    const { todayDay, lossDays } = model;
    if (lossDays <= 0) return null;
    const day = (n: number) => (n >= 0 ? String(n) : '—');
    return (
        <div className="flex items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-3" data-testid="behind-banner">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange-100 text-orange-600"><Info size={20} aria-hidden="true" /></span>
            <span className="min-w-0">
                <span className="block text-[16px] font-extrabold text-orange-900">{SC.behind(lossDays)}</span>
                <span className="block text-[14px] font-bold text-orange-800">{SC.behindLine(day(todayDay + lossDays), day(todayDay))}</span>
            </span>
        </div>
    );
};
