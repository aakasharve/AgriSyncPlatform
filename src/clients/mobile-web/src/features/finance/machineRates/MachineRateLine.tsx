/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — pilot lane RATE. The machine's rate on its card on the यंत्रं page, read from the farm's
 * दरपत्रक (the machine's own line, `machineRateModel`):
 *   - a change of it still on this phone: the rate he typed, with the rate card's own "not saved yet" / "not saved, why" line;
 *   - the server's current rate: "दर: ₹ 800 तासाला"; a stopped one says so;
 *   - none: "दर लिहिलेला नाही" ONLY when the server answered this time (offline and never fetched, nothing is claimed);
 *   - "दर लिहा" / "दर बदला" only for a person the server lets set the farm's rates.
 * A seat that does not read work rates gets nothing here at all (the server's rule; never "no rate", never ₹ 0).
 */
import React from 'react';
import { Tap } from '../../../shared/components/ui/placeUi';
import { farmRateWords, queuedRateLine } from '../farmRates/farmRateWords';
import { perWhat, rateRupees } from '../farmRates/farmRateFormat';
import { canHoldRate } from './machineRateModel';
import { machineRateWords } from './machineRateWords';
import type { MachineRatesView } from './useMachineRates';

interface MachineRateLineProps {
    machineId: string;
    rates: MachineRatesView;
    language?: string | null;
    /** The step is open for this machine now: the button is not drawn twice. */
    open: boolean;
    onOpen: () => void;
}

export const MachineRateLine: React.FC<MachineRateLineProps> = ({ machineId, rates, language, open, onOpen }) => {
    if (!canHoldRate(machineId) || rates.readsRates === false) return null;
    const rate = farmRateWords(language);
    const words = machineRateWords(language);
    const queued = rates.queuedOf(machineId);
    const line = rates.lineOf(machineId);
    const live = line && !line.current.retired ? line.current : undefined;

    let text: string | null = null;
    if (queued?.payload.change === 'set' && queued.payload.amount !== undefined && queued.payload.basis && queued.payload.kind) {
        text = words.rateOf(rateRupees(queued.payload.amount), perWhat({ kind: queued.payload.kind, unit: queued.payload.unit, basis: queued.payload.basis }, rate));
    } else if (live) {
        text = words.rateOf(rateRupees(live.amount), perWhat(live, rate));
    } else if (line) {
        text = words.stopped;
    } else if (rates.known) {
        text = words.noRate;
    }

    const button = rates.mayWrite && !open;
    if (!text && !button) return null;
    return (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="machine-rate">
            {text && (
                <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-extrabold text-violet-900" data-testid="machine-rate-line">{text}</span>
                    {queued && (
                        <span className={`block text-[12.5px] font-bold ${queued.state === 'refused' ? 'text-rose-800' : 'text-stone-600'}`} role="status" data-testid="machine-rate-status">
                            {queuedRateLine(queued.state, queued.errorCode, rate)}
                        </span>
                    )}
                </span>
            )}
            {button && (
                <Tap onClick={onOpen} data-testid="machine-rate-open"
                    className="min-h-[44px] shrink-0 rounded-full bg-violet-50 px-4 text-[14px] font-extrabold text-violet-800 ring-1 ring-violet-200">
                    {live || queued ? rate.change : words.writeRate}
                </Tap>
            )}
        </div>
    );
};
