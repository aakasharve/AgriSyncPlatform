import { v4 as uuidv4 } from 'uuid';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { FarmRateBasis, FarmRateKind } from '../../../features/finance/farmRates/farmRateSchema';

/**
 * spec: plr-d10 lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 / D-43) — one change to one rate of the farm's
 * own list (`set_farm_rate.zod.ts`), queued so it works with no internet (P10); the server decides when it arrives (only
 * the farm's primary account holder in part A; refused as `ShramSafal.FarmRate.Forbidden`, parked visibly). Optional
 * values are left OUT (never `null`): the contract's optional fields take absence, not null.
 */
export interface SetFarmRateInput {
    farmId: string;
    /** The rate itself: new for a new rate, the same for every later version. */
    rateLineId: string;
    change: 'set' | 'retire';
    kind?: FarmRateKind;
    itemName?: string;
    unit?: string;
    basis?: FarmRateBasis;
    workerCategory?: string;
    amount?: number;
    effectiveFrom?: string;
    season?: string;
    endsOn?: string;
    suggestionId?: string;
}

export type SetFarmRatePayload = SetFarmRateInput & { farmRateId: string; currencyCode?: string; changedAtUtc: string };

/** A 'set' names what it is for, its kind, basis, amount and from-date; an input names its unit, work none. */
export function carriesItsValues(p: SetFarmRateInput): boolean {
    if (p.change === 'retire') return true;
    const whole = !!p.kind && !!p.itemName?.trim() && !!p.basis && typeof p.amount === 'number' && p.amount > 0 && !!p.effectiveFrom;
    if (!whole) return false;
    return p.kind === 'Input'
        ? p.basis === 'PerUnit' && !!p.unit?.trim() && !p.workerCategory
        : p.basis !== 'PerUnit' && !p.unit;
}

/** The payload exactly as the contract takes it: blank texts left out, the version id made here. */
export function buildSetFarmRatePayload(input: SetFarmRateInput, farmRateId: string, nowIso: string): SetFarmRatePayload {
    const text = (value: string | undefined) => (value && value.trim() ? value.trim() : undefined);
    const payload: SetFarmRatePayload = {
        farmRateId,
        rateLineId: input.rateLineId,
        farmId: input.farmId,
        change: input.change,
        changedAtUtc: nowIso,
    };
    if (input.change === 'set') {
        Object.assign(payload, {
            kind: input.kind,
            itemName: text(input.itemName),
            basis: input.basis,
            amount: input.amount,
            currencyCode: 'INR',
            effectiveFrom: input.effectiveFrom,
        });
        const optional = {
            unit: text(input.unit),
            workerCategory: text(input.workerCategory),
            season: text(input.season),
            endsOn: text(input.endsOn),
            suggestionId: text(input.suggestionId),
        };
        for (const [key, value] of Object.entries(optional)) {
            if (value !== undefined) (payload as unknown as Record<string, unknown>)[key] = value;
        }
    }

    return payload;
}

export class SetFarmRateCommand {
    /** Every change is its own request and its own version id: the server dedupes a repeat of the same request. */
    static async enqueue(input: SetFarmRateInput, nowIso: string = new Date().toISOString()): Promise<SetFarmRatePayload> {
        if (!carriesItsValues(input)) {
            throw new Error('set_farm_rate: a rate names what it is for, its kind, basis, amount and from-date.');
        }

        const payload = buildSetFarmRatePayload(input, uuidv4(), nowIso);
        const clientRequestId = `${SyncMutationName.SetFarmRate}:${payload.rateLineId}:${payload.farmRateId}`;
        await mutationQueue.enqueue(SyncMutationName.SetFarmRate, payload, { clientRequestId, clientCommandId: clientRequestId });
        return payload;
    }
}
