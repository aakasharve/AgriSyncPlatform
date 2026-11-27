/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — pilot lane RATE (founder 27 Nov, answer 7: "the rate card question must be asked right
 * after user adds a machine to his farm"; the machine cost "must fetch details from that what rate card they had filled").
 *
 * A machine's rate is ONE line of the farm's own दरपत्रक (lane RATE-1, `set_farm_rate`), so it is kept on the server with its history like every
 * other rate (P10) and shows in the दरपत्रक by itself. WHICH machine it belongs to rides on the line's own id: the machine's rate line id IS the
 * machine's id (both bare v4 GUIDs made on the phone; `rateLineId` is "the rate itself, the same id across all its versions"). So the existing
 * mutation carries everything and no server field is added. A machine only the phone knows (an old server's `mach_…` id) never carries a rate.
 *
 * Pure: no React, no storage, no clock.
 */
import type { SetFarmRateInput } from '../../../application/usecases/sync/SetFarmRateCommand';
import { linesOf, type FarmRateLine } from '../farmRates/farmRateLines';
import type { QueuedFarmRate } from '../farmRates/farmRateQueue';
import type { FarmRateBasis, FarmRateRow } from '../farmRates/farmRateSchema';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The machine step's basis chips: per hour first (the one a record's hours can estimate with), then the rate card's other work bases. */
export const MACHINE_RATE_BASES: readonly FarmRateBasis[] = ['PerHour', 'PerDay', 'PerAcre', 'PerTrip', 'PerTask'];

/** The longest "what it is for" the rate card keeps (`set_farm_rate` itemName, the server's `FarmRate.MaxItemName`). */
const MAX_ITEM_NAME = 120;

/** Only a machine the server knows by a bare GUID can carry a rate (its id becomes the rate line id). */
export const canHoldRate = (machineId: string): boolean => GUID.test(machineId);

/** The machine's line of the farm's rate list (current version + history), when it has one. */
export function machineRateLine(rows: readonly FarmRateRow[], machineId: string): FarmRateLine | undefined {
    return linesOf(rows.filter(r => r.rateLineId === machineId))[0];
}

/** The newest change of the machine's rate still on this phone (waiting, or refused by the server), when there is one. */
export function queuedMachineRate(queued: readonly QueuedFarmRate[], machineId: string): QueuedFarmRate | undefined {
    const mine = queued.filter(q => q.payload.rateLineId === machineId);
    return mine.length > 0 ? mine[mine.length - 1] : undefined;
}

/**
 * The version of the line in effect on `dateKey`: the NEWEST version whose start is on or before that day (a later change wins wherever it
 * covers). None when the line is stopped, when that version had ended by then, or before the rate starts. Never a guess at an older amount.
 */
export function rateInEffect(line: FarmRateLine | undefined, dateKey: string): FarmRateRow | undefined {
    if (!line || line.current.retired) return undefined;
    const covering = line.versions.filter(v => v.effectiveFrom <= dateKey);
    const version = covering.length > 0 ? covering[covering.length - 1] : undefined;
    if (!version || version.retired) return undefined;
    if (version.endsOn && version.endsOn < dateKey) return undefined;
    return version;
}

/**
 * The rate he typed for the machine, as one change of the rate card: kind Work, what it is for = the machine's name, the basis he picked, from
 * the day given. Nothing is filled in for him: a blank amount stays blank (`carriesItsValues` refuses it, P4).
 */
export function machineRateInput(
    farmId: string,
    machine: { id: string; name: string },
    amount: number | undefined,
    basis: FarmRateBasis,
    effectiveFrom: string,
): SetFarmRateInput {
    return {
        farmId,
        rateLineId: machine.id,
        change: 'set',
        kind: 'Work',
        itemName: machine.name.trim().slice(0, MAX_ITEM_NAME),
        basis,
        amount,
        effectiveFrom,
    };
}
