/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8, "Rich day cards, one renderer"; the founder's approved v5 scrolling cards)
 *
 * THE renderer of a schedule day: vertical scroll-snap cards, one idea per card, drawn from server data by `dayCardsModel` (`CardPart[]`). Used by the schedule page,
 * by planning and by a job card; nothing else draws a schedule day. A card exists only when it has something to say (the model decides, tested), so there is no empty
 * card. Three separate lines say who made it, where it comes from and who checked it; a dose is drawn only with its unit and its source, and marked when its
 * version is not checked (P4). Markup only: no storage, no network, no timers; the viewer owns those.
 */
import React from 'react';
import { Droplets, Eye, FlaskConical, Leaf, ShieldAlert, Sprout } from 'lucide-react';
import type { ScheduleChallengeContent } from '../../../../../../../sync-contract/schemas/schedule-task.zod';
import { doseLines, type CardPart } from './dayCardsModel';
import type { DayCardKind, DayCardTask, DayCardsDetail, ShownDay } from './dayCardsTypes';
import type { DayCardWords } from './dayCardWords';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { TakeIntoMyScheduleButton, type TakeHost } from '../ownSchedule/TakeIntoMyScheduleButton';

export const KIND_LOOK: Record<DayCardKind, { bg: string; fg: string; chip: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }> }> = {
    irrigation: { bg: '#CFFAFE', fg: '#0E7490', chip: '#A5F3FC', Icon: Droplets },
    nutrition: { bg: '#EDE9FE', fg: '#5B21B6', chip: '#DDD6FE', Icon: Leaf },
    spray: { bg: '#FFE4E6', fg: '#9F1239', chip: '#FECDD3', Icon: FlaskConical },
    work: { bg: '#DCFCE7', fg: '#166534', chip: '#BBF7D0', Icon: Sprout },
    observe: { bg: '#D1FAE5', fg: '#065F46', chip: '#A7F3D0', Icon: Eye },
};

const mrDigits = (n: number | string, words: DayCardWords): string => (words.back === 'मागे' ? String(n).replace(/[0-9]/g, d => '०१२३४५६७८९'[Number(d)]) : String(n));

/** A day as the farmer reads it: "दिवस १७", or "छाटणीआधी ५ दिवस" (never day 0 or a negative day). */
export function dayText(d: ShownDay | null, words: DayCardWords): string | null {
    if (!d) return null;
    if (d.shown !== null) return words.dayN(d.shown);
    if (d.daysBeforeStart !== null) return words.daysBefore(d.daysBeforeStart);
    return null;
}

/** A step position as the farmer reads it: "दिवस १७" from day 1 on, "छाटणीआधी N दिवस" before it (never day 0 or a negative day). */
export const positionText = (position: number, words: DayCardWords): string => (position >= 1 ? words.dayN(position) : words.daysBefore(1 - position));

/** When the work is, in words (a window, a repeat, a sign, "after another work", or "as needed"). */
export function timingText(t: DayCardTask, words: DayCardWords): string {
    const timing = t.task.timing;
    const from = dayText(t.shown.from, words);
    const to = dayText(t.shown.to, words);
    let base: string;
    switch (timing.timer) {
        case 'day':
            base = from && to && from !== to ? words.dayRange(from, to) : from ?? words.loose;
            break;
        case 'sign':
            base = words.whenSeen(timing.signWords ?? '');
            break;
        case 'after':
            base = words.afterTask;
            break;
        default:
            base = timing.whenWords ?? words.noDay;
    }
    if (timing.repeat === 'every_n_days' && timing.repeatInterval) base += ` · ${words.everyN(timing.repeatInterval)}`;
    return base;
}

const Chip: React.FC<{ bg: string; fg: string; children: React.ReactNode; testId?: string }> = ({ bg, fg, children, testId }) => (
    <span data-testid={testId} className="inline-flex min-h-[28px] items-center rounded-full px-3 text-[13px] font-extrabold" style={{ background: bg, color: fg }}>{children}</span>
);

const UncheckedMark: React.FC<{ words: DayCardWords }> = ({ words }) => (
    <span data-testid="unchecked-mark" className="inline-flex min-h-[28px] items-center gap-1 rounded-full bg-amber-100 px-3 text-[13px] font-extrabold text-amber-900">
        <ShieldAlert size={14} strokeWidth={2.5} aria-hidden />{words.unchecked}
    </span>
);

const CardShell: React.FC<{ type: string; accent?: string; children: React.ReactNode }> = ({ type, accent, children }) => (
    <section data-testid="day-card" data-card-type={type} className="mx-auto flex min-h-full w-full max-w-md snap-start snap-always flex-col gap-3 px-4 py-4">
        <div className="flex flex-1 flex-col gap-3 rounded-[28px] bg-white p-4 shadow-sm" style={accent ? { boxShadow: `0 0 0 2px ${accent} inset` } : undefined}>{children}</div>
    </section>
);

const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => <h2 className="text-[26px] font-black leading-tight text-stone-900">{children}</h2>;

const Reference: React.FC<{ detail: DayCardsDetail; words: DayCardWords }> = ({ detail, words }) =>
    detail.kind === 'reference' && !detail.check.isChecked ? <p data-testid="unchecked-line" className="rounded-2xl bg-amber-50 px-3 py-2 text-[14px] font-bold leading-snug text-amber-900">{words.uncheckedLine}</p> : null;

// ---- one card of each type ------------------------------------------------------------------------------------------------------------------------------------

const DayCard: React.FC<{ part: Extract<CardPart, { type: 'day' }>; words: DayCardWords }> = ({ part, words }) => (
    <CardShell type="day">
        {part.shownDay !== null && <p className="text-[18px] font-extrabold text-stone-500">{words.dayCard.stage}{part.stageName ? ` · ${part.stageName}` : ''}</p>}
        <p data-testid="day-card-day" className="text-[56px] font-black leading-none text-emerald-800">{part.shownDay !== null ? positionText(part.shownDay, words) : ''}</p>
        {part.empty ? (
            <>
                <Title>{words.dayCard.nothingToday}</Title>
                <p className="text-[17px] font-semibold leading-snug text-stone-600">{words.dayCard.nothingTodayLine}</p>
            </>
        ) : (
            <div className="flex gap-3">
                <div className="min-w-[96px] rounded-2xl border border-stone-200 px-4 py-3 text-center"><p className="text-[28px] font-black">{mrDigits(part.tasks, words)}</p><p className="text-[15px] font-extrabold">{words.dayCard.tasks(part.tasks).replace(/^\S+\s*/, '')}</p></div>
                <div className="min-w-[96px] rounded-2xl border border-stone-200 px-4 py-3 text-center"><p className="text-[28px] font-black">{mrDigits(part.looks, words)}</p><p className="text-[15px] font-extrabold">{words.dayCard.looks(part.looks).replace(/^\S+\s*/, '')}</p></div>
            </div>
        )}
        {part.challenges > 0 && <p className="text-[15px] font-bold text-rose-800">{words.dayCard.challengesInStage(part.challenges)}</p>}
    </CardShell>
);

/**
 * Slice 9: "माझ्या वेळापत्रकात घ्या" on the hero card of a work. ONLY for a followed, CHECKED reference opened for a place (`take`): never an unchecked reference (spec decision 5:
 * following opens after the check), never an own schedule, never without `take` (planning and job-card doors). The button itself hides a past day.
 */
const TakeOnHero: React.FC<{ task: DayCardTask; detail: DayCardsDetail; take: TakeHost }> = ({ task, detail, take }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    if (detail.kind !== 'reference' || !detail.check.isChecked || !take.mayTake) return null;
    const day = task.shown.to?.stored ?? task.shown.from?.stored ?? null;
    return (
        <TakeIntoMyScheduleButton place={take.place} sourceVersionId={detail.templateId} task={task.task} language={language} dayStored={day} todayStored={take.todayStored ?? null}
            mayTake planning={take.planning} onOpenConflicts={take.onOpenConflicts} />
    );
};

const HeroCard: React.FC<{ part: Extract<CardPart, { type: 'hero' }>; detail: DayCardsDetail; words: DayCardWords; take?: TakeHost }> = ({ part, detail, words, take }) => {
    const t = part.task;
    const look = KIND_LOOK[t.task.kind];
    const doses = doseLines(t.task);
    const unchecked = detail.kind === 'reference' && !detail.check.isChecked;
    return (
        <CardShell type="hero" accent={look.fg}>
            <div className="flex flex-wrap items-center gap-2">
                <Chip bg={look.chip} fg={look.fg} testId="kind-chip">{words.kind[t.task.kind]}</Chip>
                <Chip bg="#F5F5F4" fg="#44403C" testId="timing-chip">{timingText(t, words)}</Chip>
                {unchecked && <UncheckedMark words={words} />}
            </div>
            <div className="grid h-[150px] place-items-center rounded-3xl" style={{ background: look.bg, color: look.fg }} aria-hidden="true"><look.Icon size={72} strokeWidth={2} aria-hidden /></div>
            <Title>{t.task.name}</Title>
            {t.task.why && <p className="text-[17px] font-semibold leading-snug text-stone-700">{t.task.why}</p>}
            {doses.length > 0 && (
                <div data-testid="dose-box" className="rounded-2xl bg-stone-100 p-3">
                    {doses.map((d, i) => (
                        <div key={`${d.name ?? 'dose'}-${i}`} className="mb-1 last:mb-0">
                            {d.name && <p className="text-[14px] font-extrabold text-stone-600">{d.name}</p>}
                            {detail.kind === 'reference' && !(detail.check.isChecked && t.doseChecked) ? (
                                // Spec decision 5: an unchecked reference is readable, but no dose number is shown until the check.
                                <p data-testid="dose-after-check" className="text-[15px] font-bold text-amber-900">{words.doseAfterCheck}</p>
                            ) : d.text ? (
                                <>
                                    <p data-testid="dose-text" className="text-[22px] font-black leading-tight text-stone-900">{d.text}{d.perWhat ? ` / ${d.perWhat}` : ''}</p>
                                    {d.water && <p className="text-[14px] font-semibold text-stone-600">{words.chips.water}: {d.water}</p>}
                                    {detail.kind === 'reference' && <p data-testid="dose-state" className="mt-1 text-[13px] font-extrabold text-emerald-800">{words.doseChecked}</p>}
                                </>
                            ) : (
                                <p data-testid="dose-withheld" className="text-[15px] font-bold text-amber-900">{words.doseHidden}</p>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {take && <TakeOnHero task={t} detail={detail} take={take} />}
        </CardShell>
    );
};

const HowCard: React.FC<{ part: Extract<CardPart, { type: 'how' }>; words: DayCardWords }> = ({ part, words }) => {
    const look = KIND_LOOK[part.task.task.kind];
    return (
        <CardShell type="how">
            <div className="flex gap-2"><Chip bg={look.chip} fg={look.fg}>{words.kind[part.task.task.kind]}</Chip><Chip bg="#F5F5F4" fg="#44403C">{words.how}</Chip></div>
            <Title>{part.task.task.name}</Title>
            <ol className="space-y-3">
                {part.task.task.steps.map((s, i) => (
                    <li key={`${i}-${s.slice(0, 12)}`} className="flex gap-3 border-b border-stone-100 pb-3 last:border-0">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-stone-900 text-[15px] font-black text-white">{mrDigits(i + 1, words)}</span>
                        <span className="text-[18px] font-semibold leading-snug text-stone-800">{s}</span>
                    </li>
                ))}
            </ol>
        </CardShell>
    );
};

const SafetyCard: React.FC<{ part: Extract<CardPart, { type: 'safety' }>; words: DayCardWords }> = ({ part, words }) => {
    const t = part.task.task;
    return (
        <CardShell type="safety" accent="#D97706">
            <div className="flex gap-2"><Chip bg="#FEF3C7" fg="#92400E">{words.safety}</Chip></div>
            <Title>{t.name}</Title>
            {t.reEntryHours !== null && <p data-testid="re-entry" className="rounded-2xl bg-amber-50 px-3 py-3 text-[18px] font-extrabold text-amber-950">{words.chips.reEntry(t.reEntryHours)}</p>}
            {t.preHarvestDays !== null && <p data-testid="pre-harvest" className="rounded-2xl bg-amber-50 px-3 py-3 text-[18px] font-extrabold text-amber-950">{words.chips.preHarvest(t.preHarvestDays)}</p>}
            {t.warnings.length > 0 && (
                <ul className="space-y-2">{t.warnings.map((w, i) => <li key={`${i}-${w.slice(0, 12)}`} className="text-[17px] font-semibold leading-snug text-stone-800">{w}</li>)}</ul>
            )}
        </CardShell>
    );
};

const LookCard: React.FC<{ part: Extract<CardPart, { type: 'look' }>; words: DayCardWords }> = ({ part, words }) => {
    const t = part.task.task;
    const look = t.look;
    if (!look) return null;
    const rows: Array<[string, string | null]> = [[words.chips.where, look.where], [words.chips.sample, look.sample], [words.chips.sign, look.sign], [words.chips.threshold, look.threshold]];
    return (
        <CardShell type="look">
            <div className="flex gap-2"><Chip bg="#D1FAE5" fg="#065F46">{words.look}</Chip></div>
            <Title>{t.name}</Title>
            {rows.filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-stone-50 px-3 py-2"><p className="text-[13px] font-extrabold text-stone-500">{k}</p><p className="text-[18px] font-bold leading-snug text-stone-900">{v}</p></div>
            ))}
            {look.ifThen.map((p, i) => (
                <div key={`${i}-${p.if.slice(0, 10)}`} className="rounded-2xl bg-sky-50 px-3 py-2 text-[17px] font-semibold leading-snug">
                    <span className="mr-1 rounded bg-sky-700 px-1.5 py-0.5 text-[12px] font-black text-white">{words.chips.ifLabel}</span>{p.if}
                    <span className="mx-1 rounded bg-sky-700 px-1.5 py-0.5 text-[12px] font-black text-white">{words.chips.thenLabel}</span>{p.then}
                </div>
            ))}
        </CardShell>
    );
};

const AskCard: React.FC<{ part: Extract<CardPart, { type: 'ask' }>; words: DayCardWords; onAnswer: (changes: string | null) => void }> = ({ part, words, onAnswer }) => {
    const ask = part.task.task.ask;
    if (!ask) return null;
    const changesOf = (code: string): string | null => ask.answers.find(a => a.answer === code)?.changes ?? null;
    return (
        <CardShell type="ask" accent="#F59E0B">
            <div className="flex gap-2"><Chip bg="#FEF3C7" fg="#92400E">{words.askTitle}</Chip></div>
            <Title>{part.task.task.name}</Title>
            <p data-testid="ask-question" className="rounded-2xl bg-amber-50 px-3 py-3 text-[20px] font-extrabold leading-snug text-stone-900">{ask.question}</p>
            {ask.when && <p className="text-[14px] font-semibold text-stone-500">{ask.when}</p>}
            <div className="mt-auto flex gap-3">
                <button type="button" data-testid="ask-yes" onClick={() => onAnswer(changesOf('yes'))} className="min-h-[56px] flex-1 rounded-2xl bg-emerald-800 text-[22px] font-black text-white">{words.yes}</button>
                <button type="button" data-testid="ask-no" onClick={() => onAnswer(changesOf('no'))} className="min-h-[56px] flex-1 rounded-2xl border-2 border-stone-300 bg-white text-[22px] font-black text-stone-900">{words.no}</button>
            </div>
        </CardShell>
    );
};

const ChallengeCard: React.FC<{ challenge: ScheduleChallengeContent; words: DayCardWords }> = ({ challenge, words }) => (
    <CardShell type="challenge" accent="#E11D48">
        <div className="flex gap-2"><Chip bg="#FFE4E6" fg="#9F1239">{words.challenge}</Chip></div>
        <Title>{challenge.title}</Title>
        {challenge.whenWords && <p className="rounded-2xl bg-stone-50 px-3 py-2 text-[16px] font-bold"><span className="text-stone-500">{words.chips.whenItComes}: </span>{challenge.whenWords}</p>}
        {challenge.signs && <p className="rounded-2xl bg-rose-50 px-3 py-2 text-[17px] font-semibold leading-snug"><span className="font-black text-rose-800">{words.chips.howToSpot}: </span>{challenge.signs}</p>}
        {challenge.action && <p className="rounded-2xl bg-emerald-50 px-3 py-2 text-[17px] font-semibold leading-snug"><span className="font-black text-emerald-800">{words.chips.action}: </span>{challenge.action}</p>}
        {challenge.ifThen.map((p, i) => (
            <div key={`${i}-${p.if.slice(0, 10)}`} className="rounded-2xl bg-sky-50 px-3 py-2 text-[16px] font-semibold leading-snug">
                <span className="mr-1 rounded bg-sky-700 px-1.5 py-0.5 text-[12px] font-black text-white">{words.chips.ifLabel}</span>{p.if}
                <span className="mx-1 rounded bg-sky-700 px-1.5 py-0.5 text-[12px] font-black text-white">{words.chips.thenLabel}</span>{p.then}
            </div>
        ))}
    </CardShell>
);

/** The last card of a work: three separate lines (made by, source, checked by). Nothing is invented: an absent part says it is absent. */
const SourceCard: React.FC<{ part: Extract<CardPart, { type: 'source' }>; detail: DayCardsDetail; words: DayCardWords }> = ({ part, detail, words }) => {
    const t = part.task.task;
    const sources = t.sources.map(s => (s.page ? `${s.document} · ${s.page}` : s.document));
    const kindWord = detail.madeBy.ownerType ? words.source.madeByKind[detail.madeBy.ownerType] ?? null : null;
    const made = detail.kind === 'own' ? words.source.own : [kindWord, detail.madeBy.label].filter(Boolean).join(' · ') || words.source.noMaker;
    const checked = detail.kind === 'own'
        ? words.ownLine
        : detail.check.isChecked && detail.check.checkedBy ? detail.check.checkedBy : words.source.notChecked;
    return (
        <CardShell type="source">
            <div className="flex gap-2"><Chip bg="#F5F5F4" fg="#44403C">{words.sourceTitle}</Chip></div>
            <Title>{t.name}</Title>
            <div data-testid="line-made-by" className="rounded-2xl bg-stone-50 px-3 py-2"><p className="text-[13px] font-extrabold text-stone-500">{words.source.madeBy}</p><p className="text-[18px] font-bold">{made}</p></div>
            <div data-testid="line-source" className="rounded-2xl bg-stone-50 px-3 py-2"><p className="text-[13px] font-extrabold text-stone-500">{words.source.source}</p>
                {sources.length > 0 ? sources.map(s => <p key={s} className="text-[18px] font-bold">{s}</p>) : <p className="text-[18px] font-bold text-stone-600">{words.source.noSource}</p>}
            </div>
            <div data-testid="line-checked-by" className="rounded-2xl bg-stone-50 px-3 py-2"><p className="text-[13px] font-extrabold text-stone-500">{words.source.checkedBy}</p><p className="text-[18px] font-bold">{checked}</p></div>
            <p className="text-[14px] font-semibold text-stone-500">{words.source.basis[t.basis]}</p>
            <Reference detail={detail} words={words} />
        </CardShell>
    );
};

export const DayCardDeck: React.FC<{ parts: readonly CardPart[]; detail: DayCardsDetail; words: DayCardWords; onAnswer?: (changes: string | null) => void; take?: TakeHost }> = ({ parts, detail, words, onAnswer, take }) => (
    <>
        {parts.map((part, i) => {
            const key = `${part.type}-${'task' in part ? part.task.task.taskKey : 'challenge' in part ? part.challenge.challengeKey : 'day'}-${i}`;
            switch (part.type) {
                case 'day': return <DayCard key={key} part={part} words={words} />;
                case 'hero': return <HeroCard key={key} part={part} detail={detail} words={words} take={take} />;
                case 'how': return <HowCard key={key} part={part} words={words} />;
                case 'safety': return <SafetyCard key={key} part={part} words={words} />;
                case 'look': return <LookCard key={key} part={part} words={words} />;
                case 'ask': return <AskCard key={key} part={part} words={words} onAnswer={onAnswer ?? (() => undefined)} />;
                case 'challenge': return <ChallengeCard key={key} challenge={part.challenge} words={words} />;
                case 'source': return <SourceCard key={key} part={part} detail={detail} words={words} />;
                default: return null;
            }
        })}
    </>
);
