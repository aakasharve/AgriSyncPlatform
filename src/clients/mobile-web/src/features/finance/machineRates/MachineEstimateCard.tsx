/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — pilot lane RATE (founder 27 Nov, answer 7: "the machine cost reads the rate card"). The
 * "अंदाजे" machine cost of the open farm's records, on the money home, KEPT APART from confirmed money (P1: Phase 2 never impersonates Phase 1):
 *   - its own dashed amber card under the money home's figures; never added to "एकूण खर्च", never a money entry, never written to a record (P7);
 *   - each line: the day, his machine, "३ तास × ₹ 900 तासाला" and "अंदाजे ₹ 2,700" — or, for a rate the record cannot use, the rate and why
 *     there is no estimate (P5: said, never a silent blank);
 *   - the rule (`machineEstimate`): the record states no cost, means exactly one machine of his farm, that machine has a rate he typed that the
 *     server holds, per hour, and the hours he said. Anything less: no amount (P4).
 * Nothing to estimate, the farm's set not received, or a seat that does not read work rates (the server's rule): no card at all.
 */
import React, { useMemo, useState } from 'react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { DailyLog } from '../../../types';
import { useFarmSetup } from '../../profile/farmSetup/useFarmSetup';
import { moreShownText } from '../../context/components/plotSelectorRules';
import { farmRateWords } from '../farmRates/farmRateWords';
import { perWhat, rateDate, rateRupees } from '../farmRates/farmRateFormat';
import { estimatedTotal, machineEstimates, type EstimateMachine } from './machineEstimate';
import { machineRateWords } from './machineRateWords';
import { useMachineRates } from './useMachineRates';

/** Lines drawn before "आणखी N दाखवा". */
const SHOWN = 5;

interface MachineEstimateCardProps {
    farmId: string | null;
    /** The open farm's records (the app's one record list for the farm in the header). */
    logs: readonly DailyLog[];
}

export const MachineEstimateCard: React.FC<MachineEstimateCardProps> = ({ farmId, logs }) => {
    const language = useOptionalLanguage()?.language ?? 'mr';
    const words = machineRateWords(language);
    const rate = farmRateWords(language);
    const farmSetup = useFarmSetup(farmId);
    const rates = useMachineRates(farmSetup?.received ? farmId : null);
    const [showAll, setShowAll] = useState(false);

    const machines = useMemo<EstimateMachine[]>(() => (farmSetup?.received ? farmSetup.machines.map(({ item }) => ({
        id: item.id, name: item.name, machineType: item.machineType, ownership: item.ownership,
    })) : []), [farmSetup]);
    const lines = useMemo(() => machineEstimates(logs, machines, rates.rows), [logs, machines, rates.rows]);

    if (rates.readsRates === false || lines.length === 0) return null;
    const total = estimatedTotal(lines);
    const drawn = showAll ? lines : lines.slice(0, SHOWN);

    return (
        <section className="rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50/80 p-3.5" data-testid="machine-estimate">
            <p className="m-0 text-[16px] font-extrabold text-stone-900">{words.estimateTitle}</p>
            <p className="m-0 text-[13px] font-semibold leading-snug text-stone-600">{words.estimateHint}</p>
            <ul className="m-0 mt-2 list-none space-y-2 p-0">
                {drawn.map(line => {
                    const per = perWhat(line.estimate.rate, rate);
                    return (
                        <li key={line.key} className="rounded-2xl bg-white/90 p-3 ring-1 ring-amber-200" data-testid={`machine-estimate-${line.key}`}>
                            <p className="m-0 text-[14px] font-extrabold text-stone-800 [overflow-wrap:anywhere]">
                                {rateDate(line.dateKey, language)} · {line.machine.name}
                            </p>
                            {line.estimate.kind === 'estimate' ? (
                                <p className="m-0 mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2 text-[13.5px] font-bold text-stone-600">
                                    <span>{words.hours(line.estimate.hours)} × {rateRupees(line.estimate.rate.amount)} {per}</span>
                                    <span className="text-[15px] font-extrabold text-amber-800">{words.estimated(rateRupees(line.estimate.amount))}</span>
                                </p>
                            ) : (
                                <p className="m-0 mt-0.5 text-[13px] font-bold leading-snug text-stone-600">{words.noQuantity(rateRupees(line.estimate.rate.amount), per)}</p>
                            )}
                        </li>
                    );
                })}
            </ul>
            {lines.length > drawn.length && (
                <button type="button" onClick={() => setShowAll(true)} data-testid="machine-estimate-more"
                    className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border-2 border-amber-700 bg-white px-3 text-[14.5px] font-extrabold text-amber-800">
                    {moreShownText(lines.length - drawn.length, language)}
                </button>
            )}
            {total !== null && (
                <p className="m-0 mt-2 text-right text-[15px] font-extrabold text-amber-900" data-testid="machine-estimate-total">{words.estimatedTotal(rateRupees(total))}</p>
            )}
            <p className="m-0 mt-1.5 text-[12.5px] font-bold leading-snug text-stone-700" data-testid="machine-estimate-apart">{words.estimateApart}</p>
        </section>
    );
};
