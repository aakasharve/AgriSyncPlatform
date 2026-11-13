/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ADV Task 2; D-74 note, D-87 = 1, D-83 = 1, D-24d; R12, R28; P4, P10, TAP-1)
 *
 * "तुमची शेड्यूल या स्टेजमध्ये ‹कामा›बद्दल काय सांगतात" - the card in the plan form, after the work, the place and the day are chosen. For
 * the stage that holds the planned day it shows, one line per schedule the plot follows (the stage panel's chip and name):
 *   - each work of the SAME kind with how often and "या स्टेजमध्ये N वेळा" - drawn by the stage panel's own `ItemLine` (one piece, not a
 *     copy), N exactly as the server counted it; a work whose days the schedule does not write shows no number (P4);
 *   - or "या स्टेजमध्ये या शेड्यूलमध्ये हे काम नाही" for a schedule without that work;
 *   - then "हा फक्त सल्ला आहे; तुमच्या कामात यातलं काहीही आपोआप भरलं जात नाही." - nothing here is ever copied into the saved task (D-24d): this
 *     component has no way to reach the form (no callback, no state shared with it). No quantity or dose exists in the answer (P4).
 *   - no net: the last answer for that plot with the time it was received, else "नेट आल्यावर दिसेल". A 404, a refusal, an error or an answer
 *     that cannot be read draws NOTHING (`scheduleAdviceClient`); so does an answer that says he must choose a schedule first (the page's
 *     own ask stands in front of the form) or one with no stage to speak of (no stage is invented).
 * Words: `plannedWorkWords` (the card's own) and `scheduleGateCopy` (the panel's own); Marathi mode shows Marathi only, English mode English only.
 */
import React from 'react';
import type { ScheduleAdviceLineDto } from '../../../infrastructure/api/scheduleAdviceDtos';
import { stageNameMr } from '../../scheduler/schedulePage/scheduleCopy';
import { SCHEDULE_GATE_WORDS, type GateLanguage } from '../../scheduler/schedulePage/scheduleGateCopy';
import { scheduleNameMr } from '../../scheduler/schedulePage/scheduleNames';
import { GLASS } from '../../scheduler/schedulePage/scheduleUi';
import { ItemLine, ScheduleChip, stamp } from '../../scheduler/schedulePage/StagePlanCard';
import { plannedWorkWords } from '../plannedWorkWords';
import { useScheduleAdvice, type ScheduleAdviceAsk, type ScheduleAdviceResult } from '../data/scheduleAdviceClient';

const AdviceLine: React.FC<{ line: ScheduleAdviceLineDto; language: GateLanguage }> = ({ line, language }) => {
    const gate = SCHEDULE_GATE_WORDS[language];
    const words = plannedWorkWords(language);
    const own = line.origin === 'Own' || line.slot === 0;
    const name = language === 'mr' ? scheduleNameMr(line.scheduleName) : line.scheduleName;
    return (
        <article className="space-y-2 rounded-3xl border border-stone-200 bg-white/90 p-3" data-testid={`schedule-advice-line-${line.subscriptionId}`}
            data-slot={line.slot ?? ''} data-origin={own ? 'Own' : 'Outside'}>
            <div className="flex flex-wrap items-center gap-2">
                <ScheduleChip slot={line.slot} own={own} />
                <strong className="min-w-0 flex-1 text-[17px] font-black leading-snug text-stone-900">{own ? `${gate.ownShort} · ${name}` : name}</strong>
            </div>
            {line.nothingInStage || line.items.length === 0
                ? <p className="m-0 text-[15px] font-bold text-stone-600" data-testid="schedule-advice-nothing">{words.adviceNothingInStage}</p>
                : <ul className="m-0 space-y-1.5 p-0">{line.items.map(i => <ItemLine key={i.activityId} item={i} language={language} />)}</ul>}
        </article>
    );
};

/** The card for an answer already in hand (the pure view; `ScheduleAdviceCard` below asks the server). */
export const ScheduleAdviceView: React.FC<{ result: ScheduleAdviceResult; language: GateLanguage; work: string }> = ({ result, language, work }) => {
    const gate = SCHEDULE_GATE_WORDS[language];
    const words = plannedWorkWords(language);
    if (result.kind === 'none') return null;
    const advice = result.kind === 'advice' ? result.advice : null;
    // He must choose a schedule first (the page's ask stands in front of the form), or there is no stage to speak of: nothing true to draw.
    if (advice && (advice.needsSchedule || (!advice.notRecognised && (advice.stage === null || advice.lines.length === 0)))) return null;
    const shownWork = (result.kind === 'advice' ? result.words : work).trim();
    const stage = advice?.stage ?? null;
    const stageName = stage ? (language === 'mr' ? stageNameMr(stage.name) : stage.name) : null;
    return (
        <section className={`space-y-3 rounded-3xl p-4 ${GLASS}`} data-testid="schedule-advice-card" data-language={language}
            data-source={result.kind === 'advice' ? result.source : 'offline'}>
            <h4 className="m-0 text-[18px] font-black leading-snug text-stone-900" data-testid="schedule-advice-title">{words.adviceTitle(shownWork)}</h4>
            {result.kind === 'offline' && <p className="m-0 text-[16px] font-bold text-stone-700" data-testid="schedule-advice-offline">{gate.offline}</p>}
            {advice?.notRecognised && <p className="m-0 text-[15px] font-bold text-stone-700" data-testid="schedule-advice-not-recognised">{words.adviceNotRecognised}</p>}
            {advice && !advice.notRecognised && stage && stageName && (
                <div className="space-y-0.5">
                    <p className="m-0 text-[17px] font-black text-emerald-900" data-testid="schedule-advice-stage">{stageName} <span className="text-[15px] font-bold text-stone-700">({gate.dayRange(stage.startDay, stage.endDay)})</span></p>
                    <p className="m-0 text-[15px] font-extrabold text-stone-800" data-testid="schedule-advice-day">{gate.onDay(stage.dayToday)}</p>
                </div>
            )}
            {result.kind === 'advice' && result.source === 'cache' && (
                <p className="m-0 text-[14px] font-bold text-stone-600" data-testid="schedule-advice-asof">{gate.asOf(stamp(result.receivedAtUtc))}</p>
            )}
            {advice && !advice.notRecognised && advice.lines.map(l => <AdviceLine key={l.subscriptionId} line={l} language={language} />)}
            <p className="m-0 text-[14px] font-bold leading-snug text-stone-600" data-testid="schedule-advice-footer">{words.adviceOnlyAdvice}</p>
        </section>
    );
};

/**
 * The card for one question (`ask` null = nothing to ask yet: no card). Asked after a pause in his typing, again when the question
 * changes; draws nothing while the first answer is on its way and whenever there is nothing true to draw. Read-only: it takes no
 * callback and writes nothing into the form.
 */
export const ScheduleAdviceCard: React.FC<{ ask: ScheduleAdviceAsk | null; language: string | null | undefined; debounceMs?: number }> = ({ ask, language, debounceMs }) => {
    const gateLanguage: GateLanguage = language === 'en' ? 'en' : 'mr';
    const result = useScheduleAdvice(ask, debounceMs);
    return result ? <ScheduleAdviceView result={result} language={gateLanguage} work={ask?.words ?? ''} /> : null;
};

export default ScheduleAdviceCard;
