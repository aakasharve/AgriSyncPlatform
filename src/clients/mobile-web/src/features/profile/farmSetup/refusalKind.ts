/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P11) - the kind of a farm-setup refusal, by the server code's LAST segment
 * (the rule `RejectionPolicy.normalizeCode` follows; SERVER-REPORT §3). Pure, so the conflict page and the setup screens read it the same way.
 *   - stale     `ShramSafal.FarmSetup.Conflict` - another phone changed (or removed) it first, a lost race, an id another farm holds;
 *   - forbidden `ShramSafal.Forbidden` - no "edit farm setup" on this farm;
 *   - invalid   `ShramSafal.FarmSetupInvalid`, `ShramSafal.SyncInvalidPayload`, `ShramSafal.InvalidCommand` - the content as sent.
 */
export type FarmSetupRefusalKind = 'stale' | 'forbidden' | 'invalid' | 'other';

export function refusalKindOf(errorCode: string | null | undefined): FarmSetupRefusalKind {
    const tail = (errorCode ?? '').trim().split('.').pop()?.toUpperCase() ?? '';
    if (tail === 'CONFLICT') return 'stale';
    if (tail === 'FORBIDDEN' || tail === 'UNAUTHORIZED') return 'forbidden';
    if (tail === 'FARMSETUPINVALID' || tail === 'SYNCINVALIDPAYLOAD' || tail === 'INVALIDCOMMAND') return 'invalid';
    return 'other';
}
