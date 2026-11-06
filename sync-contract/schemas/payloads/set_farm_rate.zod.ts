// spec: plr-d10 lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 / D-43, 2026-11-06) — ONE change to ONE rate of
// ONE farm's own price and rate list. Queued like every other change, so it works with no internet; the server decides
// when it arrives (doctrine P10). The same change has a REST door (POST /shramsafal/finance/farm-rates) answered by the
// same server handler.
//
//   - `farmRateId`: the id of the NEW version this change makes (made on the phone, so a repeat is the same row).
//   - `rateLineId`: the rate itself — the same id across all its versions (new for a new rate).
//   - `change`: 'set' (a new rate, or a new version of one) or 'retire' (stop it: a new version marked stopped — who and
//     when — never a deletion, P3). A 'retire' carries no values: the server copies the current version's.
//   - `kind`: 'Input' (an input's price) or 'Work' (a work or service rate).
//   - `itemName`: what it is for, in his words (कशासाठी).
//   - `unit` + `basis`: an input is 'PerUnit' with the unit he names (पोते, किलो); work is 'PerDay' | 'PerHour' |
//     'PerAcre' | 'PerTrip' | 'PerTask' and names no unit. `workerCategory`: for work only, a worker type or crew (free text).
//   - `amount` in `currencyCode`, from `effectiveFrom`; optional `season` and `endsOn`.
//   - `suggestionId`: the ShramSafal suggested rate he confirmed this from (provenance only; the row is his).
//   - `changedAtUtc`: when the phone made the change (recorded, never trusted for ordering: the server numbers versions).
//
// The server checks, in code: the sender is the farm's PRIMARY ACCOUNT HOLDER (part A; refused as
// ShramSafal.FarmRate.Forbidden, which every phone parks visibly); the line, if it exists, is THIS farm's (E4); the values
// are whole for a 'set'. There is no version on the wire: the server numbers them.
//
// Every field a 'retire' leaves out is optional here; `setFarmRateCarriesItsValues` below is the 'set' rule the phone
// checks before queuing and the server enforces (a value-less 'set' is refused, parked on every phone).
import { z } from 'zod';
import { ZGuid, ZIsoDate } from './_shared.zod';

const ZDateKey = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const FarmRateChangeEnum = z.enum(['set', 'retire']);
export const FarmRateKindEnum = z.enum(['Input', 'Work']);
export const FarmRateBasisEnum = z.enum(['PerUnit', 'PerDay', 'PerHour', 'PerAcre', 'PerTrip', 'PerTask']);

export const SetFarmRatePayload = z.object({
    farmRateId: ZGuid,
    rateLineId: ZGuid,
    farmId: ZGuid,
    change: FarmRateChangeEnum,
    kind: FarmRateKindEnum.optional(),
    itemName: z.string().min(1).max(120).optional(),
    unit: z.string().min(1).max(40).optional(),
    basis: FarmRateBasisEnum.optional(),
    workerCategory: z.string().min(1).max(80).optional(),
    amount: z.number().positive().optional(),
    currencyCode: z.string().length(3).optional(),
    effectiveFrom: ZDateKey.optional(),
    season: z.string().min(1).max(60).optional(),
    endsOn: ZDateKey.optional(),
    suggestionId: ZGuid.optional(),
    changedAtUtc: ZIsoDate,
});

export type SetFarmRatePayloadType = z.infer<typeof SetFarmRatePayload>;

/** A 'set' names what it is for, its kind, basis, amount, currency and from-date; an input also names its unit. */
export function setFarmRateCarriesItsValues(payload: SetFarmRatePayloadType): boolean {
    if (payload.change === 'retire') return true;
    const whole = !!payload.kind && !!payload.itemName && !!payload.basis && payload.amount !== undefined
        && !!payload.currencyCode && !!payload.effectiveFrom;
    if (!whole) return false;
    return payload.kind === 'Input'
        ? payload.basis === 'PerUnit' && !!payload.unit && payload.workerCategory === undefined
        : payload.basis !== 'PerUnit' && payload.unit === undefined;
}
