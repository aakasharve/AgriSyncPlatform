/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 5; D-99 layout B, R10, R28, R34; P3, P4, P10, TAP-1)
 *
 * "या स्टेजमध्ये शेड्यूल काय सांगतात" - the stage panel. For the plot's CURRENT stage it shows what each schedule the plot follows asks:
 *   - the schedules outside (1, 2, 3 in their colours; a place the server did not name shows no number), then his own (a pencil chip);
 *     inside each one the four parts in the app's own order (`PARTS`, `PART_LABEL`, `PartIcon` - nothing re-typed), and the parts a
 *     schedule has nothing for named in ONE line (layout B, D-99; no switch, no layout A);
 *   - each work with how often (the schedule's STORED repeat) and "या स्टेजमध्ये N वेळा" - N is `TimesInStage` EXACTLY as the server counted it
 *     from the days the schedule stores; a tap on it lists those days. A work whose days the schedule does not write shows "दिवस
 *     शेड्यूलमध्ये लिहिलेले नाहीत" and NO number (P4); a work that must follow another says "क्रम: ‹काम› झाल्यावर" (R34);
 *   - NO done count and NO quantity: one line sends him to तुलना for how much was done (P3);
 *   - no net: the last answer with the time it was received, else "नेट आल्यावर दिसेल". A 404, a refusal, an error or an answer that cannot
 *     be read draws NOTHING (`stagePlanClient`), never a fake.
 * In the trial this card IS "today's stage in full" (R10): the server answers for that stage only.
 * Words: `scheduleGateCopy` (Marathi mode Marathi only, English mode English only). The Marathi forms of the data (stage, schedule and
 * work names) are the app's existing tables; a name nobody has translated is shown as written (the schedule's content, not the app's words).
 */
import React, { useMemo, useState } from 'react';
import { Flag, Pencil } from 'lucide-react';
import { Tap } from '../../../shared/components/ui/placeUi';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { PlotStagePlanDto, StagePlanItemDto, StagePlanScheduleDto } from '../../../infrastructure/api/stagePlanDtos';
import { stageNameMr } from './scheduleCopy';
import { SCHEDULE_GATE_WORDS, type GateLanguage } from './scheduleGateCopy';
import { PARTS, PART_LABEL, type Part } from './scheduleModel';
import { scheduleNameMr, taskNameMr } from './scheduleNames';
import { OWN_COLOUR, PLACE_COLOUR } from './ThreePlusOneSection';
import { GLASS, PartIcon } from './scheduleUi';
import { THREE_PLUS_ONE_WORDS } from './threePlusOneCopy';
import { useStagePlan, type StagePlanResult } from './stagePlanClient';

const asPart = (value: string): Part => (PARTS as readonly string[]).includes(value) ? (value as Part) : 'work';

/** "26-10 14:30" - the day and time the server gave the answer, in digits only (no month name to translate). */
export const stamp = (utc: string): string => {
    const d = new Date(utc);
    if (Number.isNaN(d.getTime())) return '';
    const two = (n: number) => String(n).padStart(2, '0');
    return `${two(d.getDate())}-${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

/** One work of a schedule with how often and "या स्टेजमध्ये N वेळा" - also the line the plan form's advice card draws (lane SCH-ADV): one piece, never a copy. */
export const ItemLine: React.FC<{ item: StagePlanItemDto; language: GateLanguage }> = ({ item, language }) => {
    const words = SCHEDULE_GATE_WORDS[language];
    const [open, setOpen] = useState(false);
    const title = language === 'mr' ? taskNameMr(item.title) : item.title.trim();
    const after = item.afterTitle ? (language === 'mr' ? taskNameMr(item.afterTitle) : item.afterTitle.trim()) : null;
    const repeat = item.frequencyMode === 'OneTime' ? words.once
        : item.frequencyMode === 'EveryNDays' && item.intervalDays !== null ? words.everyNDays(item.intervalDays)
            : item.frequencyMode === 'PerWeek' && item.intervalDays !== null ? words.perWeek(item.intervalDays)
                : null;
    // The server counted: `timesInStage` is shown as it is, and the days only where it sent them (never recounted, never invented).
    const times = item.timesInStage;
    const days = item.days;
    return (
        <li className="list-none rounded-2xl border border-white/60 bg-white/80 px-3 py-2.5 shadow-sm" data-testid={`stage-plan-item-${item.activityId}`}>
            <span className="block text-[17px] font-extrabold leading-snug text-stone-900">{title}</span>
            {repeat && <span className="block text-[14.5px] font-bold text-stone-600" data-testid={`stage-plan-repeat-${item.activityId}`}>{repeat}</span>}
            {times !== null ? (
                days !== null ? (
                    <Tap onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid={`stage-plan-times-${item.activityId}`}
                        className="mt-1 inline-flex min-h-[48px] items-center rounded-full bg-emerald-50 px-4 text-[16px] font-extrabold text-emerald-900 ring-1 ring-emerald-200">
                        {words.times(times)}
                    </Tap>
                ) : (
                    <span className="mt-1 inline-flex min-h-[44px] items-center text-[16px] font-extrabold text-emerald-900" data-testid={`stage-plan-times-${item.activityId}`}>{words.times(times)}</span>
                )
            ) : (
                <span className="mt-1 block text-[14.5px] font-bold text-stone-600" data-testid={`stage-plan-nodays-${item.activityId}`}>{words.daysNotWritten}</span>
            )}
            {open && days !== null && (
                <span className="mt-1 block text-[15px] font-bold text-stone-800" data-testid={`stage-plan-days-${item.activityId}`}>{words.daysList(days.join(', '))}</span>
            )}
            {after && <span className="mt-1 block text-[14.5px] font-extrabold text-amber-900" data-testid={`stage-plan-after-${item.activityId}`}>{words.afterWork(after)}</span>}
        </li>
    );
};

/** The schedule's number chip (a place 1, 2, 3 in its colour; a pencil for his own; blank for a place the server did not name). */
export const ScheduleChip: React.FC<{ slot: number | null; own: boolean }> = ({ slot, own }) => {
    const colour = own ? OWN_COLOUR : typeof slot === 'number' ? PLACE_COLOUR[slot - 1] ?? PLACE_COLOUR[2] : '#78716c';
    return (
        <span data-testid="stage-plan-chip" data-slot={slot ?? ''} data-own={own ? 'yes' : 'no'}
            className="grid h-8 min-w-[32px] shrink-0 place-items-center rounded-full px-2 text-[16px] font-black text-white" style={{ background: colour }}>
            {own ? <Pencil size={16} aria-hidden="true" /> : typeof slot === 'number' ? slot : ''}
        </span>
    );
};

const ScheduleBlock: React.FC<{ schedule: StagePlanScheduleDto; language: GateLanguage }> = ({ schedule, language }) => {
    const words = SCHEDULE_GATE_WORDS[language];
    const own = schedule.origin === 'Own' || schedule.slot === 0;
    const name = language === 'mr' ? scheduleNameMr(schedule.name) : schedule.name;
    const partLabel = (p: Part) => (language === 'mr' ? PART_LABEL[p] : words.parts[p]);
    const filled = PARTS.filter(p => schedule.items.some(i => asPart(i.part) === p));
    const empty = PARTS.filter(p => !filled.includes(p));
    return (
        <article className="space-y-2 rounded-3xl border border-stone-200 bg-white/90 p-3" data-testid={`stage-plan-schedule-${schedule.subscriptionId}`}
            data-slot={schedule.slot ?? ''} data-origin={own ? 'Own' : 'Outside'}>
            <div className="flex flex-wrap items-center gap-2">
                <ScheduleChip slot={schedule.slot} own={own} />
                <strong className="min-w-0 flex-1 text-[17px] font-black leading-snug text-stone-900">{own ? `${words.ownShort} · ${name}` : name}</strong>
                {schedule.isMain && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[14px] font-extrabold text-amber-900" data-testid="stage-plan-main">
                        <Flag size={14} aria-hidden="true" />{THREE_PLUS_ONE_WORDS[language].main}
                    </span>
                )}
            </div>
            {filled.map(p => (
                <div key={p} data-testid={`stage-plan-part-${p}`} data-part={p}>
                    <p className="m-0 mb-1.5 flex items-center gap-2 text-[16px] font-extrabold text-stone-800"><PartIcon part={p} />{partLabel(p)}</p>
                    <ul className="m-0 space-y-1.5 p-0">
                        {schedule.items.filter(i => asPart(i.part) === p).map(i => <ItemLine key={i.activityId} item={i} language={language} />)}
                    </ul>
                </div>
            ))}
            {empty.length > 0 && (
                <p className="m-0 text-[14.5px] font-bold text-stone-600" data-testid="stage-plan-empty-parts">{words.nothingInStage(empty.map(partLabel).join(', '))}</p>
            )}
        </article>
    );
};

/** The panel for an answer already in hand (the pure view; `StagePlanCard` below asks the server). */
export const StagePlanView: React.FC<{ result: StagePlanResult; language: GateLanguage }> = ({ result, language }) => {
    const words = SCHEDULE_GATE_WORDS[language];
    if (result.kind === 'none') return null;
    const plan: PlotStagePlanDto | null = result.kind === 'plan' ? result.plan : null;
    const stage = plan?.stage ?? null;
    const stageName = stage ? (language === 'mr' ? stageNameMr(stage.name) : stage.name) : null;
    return (
        <section className={`space-y-3 rounded-3xl p-4 ${GLASS}`} data-testid="stage-plan-card" data-language={language} data-source={result.kind === 'plan' ? result.source : 'offline'}>
            <h3 className="m-0 text-[19px] font-black text-stone-900" data-testid="stage-plan-title">{words.panelTitle}</h3>
            {result.kind === 'offline' && <p className="m-0 text-[16px] font-bold text-stone-700" data-testid="stage-plan-offline">{words.offline}</p>}
            {plan && (
                <>
                    {stage && stageName && (
                        <div className="space-y-0.5">
                            <p className="m-0 text-[18px] font-black text-emerald-900" data-testid="stage-plan-stage">{stageName} <span className="text-[15px] font-bold text-stone-700">({words.dayRange(stage.startDay, stage.endDay)})</span></p>
                            <p className="m-0 text-[15px] font-extrabold text-stone-800" data-testid="stage-plan-day">{words.onDay(stage.dayToday)}</p>
                        </div>
                    )}
                    {result.kind === 'plan' && result.source === 'cache' && (
                        <p className="m-0 text-[14px] font-bold text-stone-600" data-testid="stage-plan-asof">{words.asOf(stamp(result.receivedAtUtc))}</p>
                    )}
                    {plan.schedules.length === 0
                        ? <p className="m-0 text-[16px] font-bold text-stone-700" data-testid="stage-plan-none">{words.noneFollowed}</p>
                        : plan.schedules.map(s => <ScheduleBlock key={s.subscriptionId} schedule={s} language={language} />)}
                    <p className="m-0 text-[14px] font-bold leading-snug text-stone-600" data-testid="stage-plan-footer">{words.footer}</p>
                </>
            )}
        </section>
    );
};

/**
 * The panel for one plot. `followedKey` changes when the schedules the plot follows change, and the server is asked again. Draws nothing
 * while the first answer is on its way and whenever there is nothing true to draw.
 */
export const StagePlanCard: React.FC<{ plotId: string; followedKey: string }> = ({ plotId, followedKey }) => {
    const language: GateLanguage = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const result = useStagePlan(plotId, followedKey);
    return useMemo(() => (result ? <StagePlanView result={result} language={language} /> : null), [result, language]);
};

export default StagePlanCard;
