/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, verifier MU2-V1) — what the SERVER lets this seat
 * do with money that is already recorded, read from `/me/context` so the phone never draws a step
 * the server refuses (doctrine P5).
 *
 * Splitting a whole-farm bill over the plots (`allocate_global_expense`) and correcting a cost are
 * CHANGING money: the server's review-money permission (`ReviewMoney`; step 2 called it `AddCost`;
 * founder D-22 and alignment M-5) — the farm's primary owner always, anyone else only when he
 * stored it for them.
 * RECORDING a purchase is not this: every Active member records one.
 */
import type { MeFarm } from './MeContextService';

/**
 * The permission name the server sends for "may change money already recorded": lane 2b fix 1 made
 * it `ReviewMoney` (a new bit). The step-2 name `AddCost` is still read from a server that predates
 * it; a 2b server never sends it.
 */
export const CHANGE_MONEY_PERMISSION = 'ReviewMoney';
const STEP2_CHANGE_MONEY_PERMISSION = 'AddCost';

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
    return permissions.includes(CHANGE_MONEY_PERMISSION) || permissions.includes(STEP2_CHANGE_MONEY_PERMISSION);
}
