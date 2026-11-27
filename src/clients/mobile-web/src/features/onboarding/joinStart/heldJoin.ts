/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V1-A) — the farm a person scanned or typed BEFORE
 * the SMS code, held on the phone until he has signed in.
 *
 * SERVER CHECK (repo truth, 27 Nov): every join call needs a signed-in, phone-verified person — `POST /join/claim`
 * (`ClaimJoinValidator`, the endpoint's `phone_verified` claim), `POST /join/by-code` (`JoinByCodeValidator`) and
 * `POST /invitations/find` + `/accept` (the `/shramsafal` group's `RequireAuthorization`). None can be made, or held on
 * the server, before the OTP is verified, and none should: a request the owner sees must come from a proven number.
 * So the order the founder asked for — scan or code first, SMS second — is kept ON THE PHONE: the code waits here,
 * and the signed-in app sends it once, right after the OTP (`useFarmContextState` → `JoinByCodeScreen`). This is the
 * same hand-over the login screen's join button already used (`rememberJoinAfterSignIn`), now carrying the code itself.
 *
 * Nothing is asked of the server before sign-in, so nothing here knows the farm's NAME: the screens never say
 * "‹farm› found" before the server has said so (P4/P5).
 *
 * sessionStorage, like `farmCodeEntry.ts`'s hand-over: it survives a reload during the OTP step and ends with the app
 * session. It holds a farm code, an invitation code or a farm QR's link token — never a phone number, never a name.
 */
import { normalizeInvitationCode } from '../../invitations/invitationModel';
import { isCompleteFarmCode, normalizeFarmCode, readJoinLink } from '../qr/farmCodeEntry';

/** What he gave before signing in: the owner's farm QR, a typed farm code, or a personal invitation's 8 digits. */
export type HeldJoin =
    | { kind: 'qr'; token: string; farmCode: string }
    | { kind: 'farmCode'; code: string }
    | { kind: 'invitation'; code: string };

const HELD_JOIN_KEY = 'agrisync:held-join';
const OWN_FARM_KEY = 'agrisync:own-farm-first';

const session = (): Storage | null => {
    try {
        return typeof window === 'undefined' ? null : window.sessionStorage;
    } catch {
        return null;
    }
};

const isHeldJoin = (value: unknown): value is HeldJoin => {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    if (v.kind === 'qr') return typeof v.token === 'string' && v.token.length > 0 && typeof v.farmCode === 'string' && v.farmCode.length > 0;
    if (v.kind === 'farmCode') return typeof v.code === 'string' && isCompleteFarmCode(v.code);
    if (v.kind === 'invitation') return typeof v.code === 'string' && normalizeInvitationCode(v.code) === v.code;
    return false;
};

/**
 * What a typed (or pasted) text is: an invitation's 8 digits (also its shared link), a farm's 6-character code, or a farm
 * QR's link. `null` when it is none of these yet — the "पाठवा" button stays grey, and nothing is sent anywhere.
 */
export function readTypedJoin(raw: string): HeldJoin | null {
    const invitation = normalizeInvitationCode(raw);
    if (invitation) return { kind: 'invitation', code: invitation };
    const link = readJoinLink(raw);
    if (link) return { kind: 'qr', token: link.token, farmCode: link.farm };
    const code = normalizeFarmCode(raw);
    return isCompleteFarmCode(code) ? { kind: 'farmCode', code } : null;
}

/** What a scanned QR is: the owner's farm QR (either link shape) or a personal invitation's QR. */
export function readScannedJoin(raw: string | null | undefined): HeldJoin | null {
    if (!raw) return null;
    const link = readJoinLink(raw);
    if (link) return { kind: 'qr', token: link.token, farmCode: link.farm };
    const invitation = normalizeInvitationCode(raw);
    return invitation ? { kind: 'invitation', code: invitation } : null;
}

export function holdJoin(join: HeldJoin): void {
    try {
        session()?.setItem(HELD_JOIN_KEY, JSON.stringify(join));
        session()?.removeItem(OWN_FARM_KEY);
    } catch {
        /* storage blocked: after sign-in he types the code in the join door instead */
    }
}

export function peekHeldJoin(): HeldJoin | null {
    try {
        const raw = session()?.getItem(HELD_JOIN_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isHeldJoin(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/** Reads AND clears it, so it is sent once. */
export function takeHeldJoin(): HeldJoin | null {
    const held = peekHeldJoin();
    try {
        session()?.removeItem(HELD_JOIN_KEY);
    } catch {
        /* nothing to clear */
    }
    return held;
}

/** "नाही, मी स्वतः सुरू करतोय": after sign-in, a person with no farm goes straight to making his own. */
export function holdOwnFarmStart(): void {
    try {
        session()?.setItem(OWN_FARM_KEY, '1');
        session()?.removeItem(HELD_JOIN_KEY);
    } catch {
        /* storage blocked: he meets the two doors after sign-in and picks his own farm there */
    }
}

/** Reads AND clears the wish. */
export function takeOwnFarmStart(): boolean {
    try {
        const wanted = session()?.getItem(OWN_FARM_KEY) === '1';
        session()?.removeItem(OWN_FARM_KEY);
        return wanted;
    } catch {
        return false;
    }
}

/** Back to the start, or "आधीच वापरता? लॉगिन करा": nothing he chose before is carried into sign-in. */
export function dropJoinStartChoices(): void {
    try {
        session()?.removeItem(HELD_JOIN_KEY);
        session()?.removeItem(OWN_FARM_KEY);
    } catch {
        /* nothing to clear */
    }
}
