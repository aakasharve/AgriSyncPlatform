/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9) - numbers on the farm-setup forms: the server keeps two decimals and REFUSES more
 * (`ShramSafal.FarmSetupInvalid`), and the phone never rounds what he typed in silence. So a number box keeps at most two decimals AS HE TYPES (what he
 * sees is what is sent), and the doors refuse anything finer before it is queued. Pure.
 */

/** Two decimals at most (the server's columns); more is refused, never rounded. */
export function hasAtMostTwoDecimals(n: number): boolean {
    return Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

/** A form's number box as he types: anything past two decimals is not taken ("7.555" stays "7.55"). */
export function twoDecimalsInput(raw: string): string {
    const match = /^(\d*)([.,]?)(\d{0,2})/.exec(raw.trim());
    return match ? `${match[1]}${match[2] ? '.' : ''}${match[3]}` : '';
}
