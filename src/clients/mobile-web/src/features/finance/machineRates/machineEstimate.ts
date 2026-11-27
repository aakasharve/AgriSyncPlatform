/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — pilot lane RATE (founder 27 Nov, answer 7: "the machine cost reads the rate card").
 *
 * The "अंदाजे" (estimated) machine cost of a saved record's machine line. It is Phase 2 (P1): derived, never stored, never money, and it never
 * changes the record (P7: this reads, it writes nothing). It exists ONLY when every piece of it is his (P4):
 *   1. the line states NO machine money: a stated rent or fuel amount (even 0) is the truth and is never estimated over — and then no money
 *      entry exists for the line, so the estimate is never counted twice;
 *   2. the line can mean exactly ONE machine of his farm: the same kind (`FARM_TYPES_OF`), and the ownership not contradicted (a line that says
 *      "rented" is never his own tractor). Two possible machines, or none = no estimate;
 *   3. that machine has a rate HE typed (its rate card line: `machineRateModel`), in effect on the record's day. No rate = no estimate;
 *   4. the rate is per hour and the line states the hours HE said: estimate = rate x hours, to the paisa.
 * A rate on any other basis (day, acre, trip, task), or hours not said, gives the rate with "the record does not say how much" and NO amount: a
 * record line holds no days, acres or trips, and one is never assumed (a record's day is not "one day of hire", a plot's area is not the area
 * worked). Pure: no React, no storage, no clock.
 */
import type { DailyLog, MachineryEvent } from '../../../types';
import { LogVerificationStatus } from '../../../domain/types/log.types';
import type { FarmMachineOwnership, FarmMachineType } from '../../../domain/types/farmSetup.types';
import type { FarmRateRow } from '../farmRates/farmRateSchema';
import { machineRateLine, rateInEffect } from './machineRateModel';

/** One machine of the farm as the estimate needs it (from the farm's set, `farmsetup.machine.*`). */
export interface EstimateMachine {
    id: string;
    name: string;
    machineType: FarmMachineType;
    ownership: FarmMachineOwnership;
}

export type MachineEstimate =
    /** rate x hours: `amount` in rupees, to the paisa. */
    | { kind: 'estimate'; amount: number; hours: number; rate: FarmRateRow }
    /** He has a rate for the machine, but the record does not say how much (hours for a per-hour rate; anything for the other bases). */
    | { kind: 'noQuantity'; rate: FarmRateRow };

export interface MachineEstimateLine {
    key: string;
    logId: string;
    machineLineId: string;
    dateKey: string;
    machine: EstimateMachine;
    estimate: MachineEstimate;
}

/** A blower is parsed as a sprayer that names its implement (`AgriLogResponseSchema` machinery.implement). */
const NAMES_A_BLOWER = /blower|ब्लोअर|ब्लोवर|ब्लोव्हर/i;

/** The farm machine kinds a record line's kind can mean. A kind with no farm machine type (tiller, drone, unknown) is never guessed. */
function farmTypesOf(line: MachineryEvent): readonly FarmMachineType[] {
    switch (line.type) {
        case 'tractor': return ['tractor'];
        case 'harvester': return ['harvester'];
        case 'sprayer': return line.implement && NAMES_A_BLOWER.test(line.implement) ? ['blower'] : ['sprayer'];
        default: return [];
    }
}

const ownershipFits = (line: MachineryEvent, machine: EstimateMachine): boolean =>
    line.ownership === 'unknown' || line.ownership === machine.ownership;

const stated = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

/** The line states machine money (rent or fuel, even 0): that is the truth, never estimated over. */
const statesMoney = (line: MachineryEvent): boolean => stated(line.rentalCost) || stated(line.fuelCost);

/** The hours HE said on the line, or undefined (not said, "आठवत नाही", or a value the system filled in). */
export function statedHours(line: MachineryEvent): number | undefined {
    const hours = line.hoursUsed;
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) return undefined;
    if (line.numbers?.hoursUsed?.certainty === 'unknown') return undefined;
    if (line.provenance === 'derived' || line.provenance === 'assumed' || line.provenanceVerified === false) return undefined;
    return hours;
}

const LEFT_OUT: ReadonlySet<string> = new Set([LogVerificationStatus.DISPUTED, LogVerificationStatus.CORRECTION_PENDING]);

const dateKeyOf = (log: DailyLog): string | undefined => (/^\d{4}-\d{2}-\d{2}/.test(log.date ?? '') ? log.date.slice(0, 10) : undefined);

/** rate x hours in rupees, to the paisa (no float drift such as 2031.2500000001). */
const times = (amount: number, hours: number): number => Math.round(amount * hours * 100) / 100;

/** Every record line with a machine rate behind it, newest day first. A line with no rate behind it is not listed at all. */
export function machineEstimates(
    logs: readonly DailyLog[],
    machines: readonly EstimateMachine[],
    rows: readonly FarmRateRow[],
): MachineEstimateLine[] {
    const out: MachineEstimateLine[] = [];
    for (const log of logs) {
        const dateKey = dateKeyOf(log);
        if (!dateKey || log.deletion || (log.verification && LEFT_OUT.has(log.verification.status))) continue;
        (log.machinery ?? []).forEach((line, index) => {
            if (statesMoney(line)) return;
            const types = farmTypesOf(line);
            const candidates = machines.filter(m => types.includes(m.machineType) && ownershipFits(line, m));
            if (candidates.length !== 1) return;
            const machine = candidates[0];
            const rate = rateInEffect(machineRateLine(rows, machine.id), dateKey);
            if (!rate) return;
            const hours = statedHours(line);
            const machineLineId = line.id || String(index);
            out.push({
                key: `${log.id}:${machineLineId}`,
                logId: log.id,
                machineLineId,
                dateKey,
                machine,
                estimate: rate.basis === 'PerHour' && hours !== undefined
                    ? { kind: 'estimate', amount: times(rate.amount, hours), hours, rate }
                    : { kind: 'noQuantity', rate },
            });
        });
    }
    return out.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

/** The estimated amounts added up; null when no line has an amount (never ₹ 0). */
export function estimatedTotal(lines: readonly MachineEstimateLine[]): number | null {
    const amounts = lines.flatMap(l => (l.estimate.kind === 'estimate' ? [l.estimate.amount] : []));
    return amounts.length > 0 ? Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}
