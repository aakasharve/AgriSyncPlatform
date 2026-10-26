/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S3, S15)
 *
 * "Where you are", in the preview's look (dark card, frosted tiles, emerald stage line, then the filled bar
 * with the "तुम्ही इथे आहात" pin and EVERY stage by name with its own bar). Inside the page bar that already
 * says "शेड्यूल", the card names the crop and plot. It also says who made the schedule (owner type + the
 * real name it was saved with, and its lineage) — S15. Every number is the real schedule's; a missing one is
 * "—" (P4). The schedule's name is shown in Marathi for the schedules the app ships (`scheduleNameMr`);
 * a name a person wrote is shown as written. "तुम्ही इथे आहात" marks a stage only while today is in it.
 */
import React from 'react';
import { Info, Layers, Pin } from 'lucide-react';
import LineageRibbon from '../../schedule-authoring/components/LineageRibbon';
import { CategoryIcon } from '../../logs/components/shramsathi/understandingRing/CategoryIcon';
import { Tap } from '../../../shared/components/ui/placeUi';
import type { CropScheduleTemplate } from '../scheduler.types';
import { OWNER_LABEL, SC } from './scheduleCopy';
import type { ScheduleModel } from './scheduleModel';
import { scheduleNameMr } from './scheduleNames';
import { GLASS } from './scheduleUi';

/** The saved author is shown only when it is a real name, not the catalog's internal English tag. */
const INTERNAL_AUTHORS = new Set(['ShramSafal Reference Data', 'System Fallback']);

export const OwnerBadge: React.FC<{ template: CropScheduleTemplate }> = ({ template }) => {
    const author = template.createdBy && !INTERNAL_AUTHORS.has(template.createdBy) ? template.createdBy : null;
    const extra = template as unknown as Record<string, unknown>;
    return (
        <div className="mt-2 space-y-1" data-testid="sched-owner">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[14px] font-extrabold" data-owner={template.ownerType}>
                {SC.madeBy}: {OWNER_LABEL[template.ownerType] ?? OWNER_LABEL.SYSTEM_DEFAULT}{author ? ` · ${author}` : ''}
            </span>
            <LineageRibbon
                derivedFromTemplateId={extra['derivedFromTemplateId'] as string | null | undefined}
                derivedFromName={extra['derivedFromName'] as string | null | undefined}
                version={extra['version'] as number | undefined}
                author={author}
                publishedAtUtc={(extra['publishedAtUtc'] as string | null | undefined) ?? template.publishedAt}
            />
        </div>
    );
};

export const ScheduleHeader: React.FC<{ cropName: string; plotName: string; template: CropScheduleTemplate; model: ScheduleModel }> = ({ cropName, plotName, template, model }) => {
    const stage = model.currentStage;
    const started = model.todayDay >= 0;
    const tiles: ReadonlyArray<readonly [string, string, string]> = [
        [started ? String(model.todayDay) : '—', SC.dayNow, 'day-now'],
        [model.totalDays !== null ? String(model.totalDays) : '—', SC.dayTotal, 'day-total'],
        [String(model.stages.length), SC.stageCount, 'stage-count'],
    ];
    return (
        <section className="rounded-3xl bg-gradient-to-br from-stone-900 via-stone-800 to-stone-900 p-5 text-white shadow-xl shadow-stone-900/30" data-testid="sched-header">
            <h2 className="m-0 text-[26px] font-black leading-tight tracking-tight" data-testid="sched-crop-plot">{cropName} · {plotName}</h2>
            <p className="m-0 mt-1 text-[16px] font-bold text-white/80" data-testid="sched-name">{scheduleNameMr(template.name)}</p>
            <OwnerBadge template={template} />
            <div className="mt-4 grid grid-cols-3 gap-2.5">
                {tiles.map(([n, label, id]) => (
                    <div key={id} className="rounded-2xl bg-white/10 p-3 text-center backdrop-blur-sm">
                        <div className="text-[32px] font-black leading-none" data-testid={id}>{n}</div>
                        <div className="mt-1 text-[14px] font-bold text-white/75">{label}</div>
                    </div>
                ))}
            </div>
            {!started && <p className="m-0 mt-3 text-[16px] font-bold text-amber-200" data-testid="not-started">{SC.notStarted(-model.todayDay)}</p>}
            {model.ended && <p className="m-0 mt-3 text-[16px] font-bold text-amber-200" data-testid="sched-ended">{SC.ended}</p>}
            {stage && (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/20 px-4 py-3">
                    <CategoryIcon name="sprout" size={26} className="shrink-0" />
                    <span className="text-[19px] font-black leading-snug text-emerald-300" data-testid="stage-line">
                        {SC.stage} {stage.index + 1} · {stage.name} <span className="text-[15px] font-bold text-emerald-200">({SC.dayN(stage.from)}–{stage.to})</span>
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
                <span className="ml-auto text-[18px] font-black text-emerald-700" data-testid="progress-pct">{pct === null ? '—' : `${pct}%`}</span>
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
                            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[16px] font-black ${s.current ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30' : s.past ? 'bg-emerald-600 text-white' : 'bg-stone-200 text-stone-500'}`}>{s.past ? '✓' : s.index + 1}</span>
                            <span className="min-w-0 flex-1">
                                <span className={`block text-[18px] font-extrabold leading-snug ${s.current ? 'text-emerald-900' : s.past ? 'text-stone-700' : 'text-stone-500'}`}>{s.name}</span>
                                <span className="block text-[14px] font-bold text-stone-600">{SC.dayN(s.from)}–{s.to}</span>
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

/** Nobody chose this schedule: it is the app's first one for the crop. Said plainly, with the way to choose. */
export const DefaultScheduleNote: React.FC<{ onLibrary: () => void }> = ({ onLibrary }) => (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3" data-testid="default-schedule-note">
        <p className="m-0 text-[16px] font-extrabold text-amber-950">{SC.defaultSchedule}</p>
        <Tap onClick={onLibrary} data-testid="default-schedule-library"
            className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-full border-2 border-amber-600 bg-white px-4 text-[16px] font-extrabold text-amber-900">
            {SC.chooseSchedule} →
        </Tap>
    </div>
);

/** The kept 'N days behind' banner (timelineUtils.getEffectivePhaseAndDay), in Marathi. */
export const BehindBanner: React.FC<{ lossDays?: number; effectiveDay: number | null }> = ({ lossDays, effectiveDay }) => {
    if (!lossDays || lossDays <= 0) return null;
    return (
        <div className="flex items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-3" data-testid="behind-banner">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange-100 text-orange-600"><Info size={20} aria-hidden="true" /></span>
            <span className="min-w-0">
                <span className="block text-[16px] font-extrabold text-orange-900">{SC.behind(lossDays)}</span>
                <span className="block text-[14px] font-bold text-orange-800">{SC.behindLine(effectiveDay !== null ? String(effectiveDay + lossDays) : '—', effectiveDay !== null ? String(effectiveDay) : '—')}</span>
            </span>
        </div>
    );
};
