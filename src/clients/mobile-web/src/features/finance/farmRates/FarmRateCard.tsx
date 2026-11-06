/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 / D-17 / D-43).
 *
 * One rate of the farm's own list: what it is for, the CURRENT rate per what, its kind, for whom, its season and dates,
 * and its history — every version, who set it and when, old → new (P3). The primary account holder may change it (a NEW
 * version) or stop it (a stopped version, never a deletion).
 */
import React, { useState } from 'react';
import { History, Pencil } from 'lucide-react';
import { Chip, GlassCard, Tap } from '../../../shared/components/ui/placeUi';
import { historyOf, type FarmRateLine } from './farmRateLines';
import { perWhat, rateDate, rateMoment, rateRupees } from './farmRateFormat';
import type { FarmRateWords } from './farmRateWords';

interface FarmRateCardProps {
    line: FarmRateLine;
    words: FarmRateWords;
    language: string;
    mayWrite: boolean;
    /** Who set a version: "तुम्ही" for him, a known name, or nothing (never a made-up name). */
    nameOf: (userId: string) => string | undefined;
    onChange: (line: FarmRateLine) => void;
    onRetire: (line: FarmRateLine) => void;
}

export const FarmRateCard: React.FC<FarmRateCardProps> = ({ line, words, language, mayWrite, nameOf, onChange, onRetire }) => {
    const [open, setOpen] = useState(false);
    const rate = line.current;
    const id = line.rateLineId;
    const from = rateDate(rate.effectiveFrom, language);
    const until = rateDate(rate.endsOn, language);
    return (
        <GlassCard testId={`rate-line-${id}`}>
            <div className="flex items-baseline justify-between gap-2">
                <p className="m-0 min-w-0 text-[15.5px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">{rate.itemName}</p>
                <p className="m-0 shrink-0 text-[16px] font-extrabold text-stone-900" data-testid={`rate-amount-${id}`}>
                    {rateRupees(rate.amount)}
                    <span className="text-[13px] font-bold text-stone-500"> {perWhat(rate, words)}</span>
                </p>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Chip tone={rate.kind === 'Work' ? 'amber' : 'violet'}>{words.kind[rate.kind]}</Chip>
                {rate.retired && <Chip tone="stone">{words.retired}</Chip>}
                {rate.workerCategory && <span className="text-[13px] font-bold text-stone-600">{rate.workerCategory}</span>}
                {rate.season && <span className="text-[13px] font-bold text-stone-600">{rate.season}</span>}
                {from && <span className="text-[12.5px] font-bold text-stone-500">{words.since(from)}</span>}
                {until && <span className="text-[12.5px] font-bold text-stone-500">{words.until_(until)}</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <Tap onClick={() => setOpen(v => !v)} data-testid={`rate-history-toggle-${id}`}
                    className="flex min-h-[40px] items-center gap-1 rounded-full bg-white px-3 text-[13.5px] font-extrabold text-stone-700 ring-1 ring-stone-300">
                    <History size={14} aria-hidden="true" />{words.history}
                </Tap>
                {mayWrite && !rate.retired && (
                    <>
                        <Tap onClick={() => onChange(line)} data-testid={`rate-change-${id}`}
                            className="flex min-h-[40px] items-center gap-1 rounded-full bg-white px-3 text-[13.5px] font-extrabold text-emerald-800 ring-1 ring-emerald-300">
                            <Pencil size={14} aria-hidden="true" />{words.change}
                        </Tap>
                        <Tap onClick={() => onRetire(line)} data-testid={`rate-retire-${id}`}
                            className="flex min-h-[40px] items-center rounded-full bg-white px-3 text-[13.5px] font-extrabold text-rose-800 ring-1 ring-rose-300">
                            {words.retire}
                        </Tap>
                    </>
                )}
            </div>
            {open && (
                <ol className="m-0 mt-2 list-none space-y-1 p-0" data-testid={`rate-history-${id}`}>
                    {historyOf(line).map(entry => {
                        const who = nameOf(entry.byUserId);
                        const what = entry.stopped
                            ? words.stopped
                            : entry.from === undefined
                                ? words.setTo(rateRupees(entry.to))
                                : words.changedTo(rateRupees(entry.from), rateRupees(entry.to));
                        return (
                            <li key={entry.version} className="text-[13px] font-bold text-stone-700" data-testid={`rate-history-${id}-v${entry.version}`}>
                                {rateMoment(entry.atUtc, language)}{who ? ` — ${who}` : ''}: {what}
                                {entry.fromSuggestion ? ` (${words.fromSuggestion})` : ''}
                            </li>
                        );
                    })}
                </ol>
            )}
        </GlassCard>
    );
};
