/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, verifier MU2-V1) — what the SERVER lets this seat
 * do with money that is already recorded, read from `/me/context` so the phone never draws a step
 * the server refuses (doctrine P5).
 *
 * Splitting a whole-farm bill over the plots (`allocate_global_expense`) and correcting a cost are
 * CHANGING money: the server's `AddCost` permission (`FarmPermission.AddCost`, founder D-22 and
 * alignment M-5) — the farm's primary owner always, anyone else only when he stored it for them.
 * RECORDING a purchase is not this: every Active member records one.
 */
import type { MeFarm } from './MeContextService';

/** The permission name the server sends for "may change money already recorded". */
export const CHANGE_MONEY_PERMISSION = 'AddCost';

/**
 * `true` when this seat may change recorded money (split a whole-farm bill). When the phone does
 * not KNOW — no farm context yet, or an older server that sends no `permissions` — the answer is
 * `true`: before step 2 every member could split a bill, so an older server keeps that working
 * (doctrine P11), and the server still decides every push. Only an explicit server answer that
 * lacks the permission hides the step.
 */
export function mayChangeRecordedMoney(farm: Pick<MeFarm, 'permissions'> | null | undefined): boolean {
    const permissions = farm?.permissions;
    if (!Array.isArray(permissions)) return true;
    return permissions.includes(CHANGE_MONEY_PERMISSION);
}
