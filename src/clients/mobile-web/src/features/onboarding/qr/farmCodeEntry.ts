/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the small, pure rules behind the typed farm-code
 * door (`JoinByCodeScreen`): how a typed code is cleaned up, when it looks complete enough to send by
 * itself, how a pasted QR link is recognised, and the sign-in handoff from the login screen. No
 * network here (that is `inviteApi.joinByCode`), so every rule is testable on its own.
 *
 * FORMAT (verified in the repo, not assumed): the server's ONE generator and reader,
 * `ShramSafal.Domain/Farms/FarmCode.cs`, makes 6 characters of Crockford base32
 * (`0123456789ABCDEFGHJKMNPQRSTVWXYZ` — no I, L, O or U), and its `Normalize` folds case, spaces,
 * hyphens, I/L→1, O→0 and Marathi digits (०–९). This file mirrors that reading so the phone sends
 * exactly what the server would accept; the server still decides. If `FarmCode.cs` ever changes,
 * `FARM_CODE_LENGTH`, `FARM_CODE_PATTERN` and `normalizeFarmCode` change with it.
 */

export const FARM_CODE_LENGTH = 6;
const FARM_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{6}$/;
const MARATHI_DIGIT_ZERO = '०'.charCodeAt(0);

/** Capitals, no spaces or dashes, Marathi digits as 0–9, and look-alike letters as the digits they stand for. */
export const normalizeFarmCode = (raw: string): string =>
    raw
        .replace(/[०-९]/g, d => String(d.charCodeAt(0) - MARATHI_DIGIT_ZERO))
        .toUpperCase()
        .replace(/[\s-]+/g, '')
        .replace(/O/g, '0')
        .replace(/[IL]/g, '1');

/** A cleaned-up code that can be a real farm code (right length, right letters). */
export const isCompleteFarmCode = (code: string): boolean => FARM_CODE_PATTERN.test(code);

/** The person pasted (or is typing) a web link, not a code. */
export const looksLikeLink = (raw: string): boolean => /^\s*https?:\/\//i.test(raw) || raw.includes('://');

export interface JoinLink {
    token: string;
    farm: string;
}

/**
 * A pasted QR link, in either of the two link shapes in use (`?join=&farm=` from the QR sheet,
 * `?t=&f=` from the server's own payload). `null` when it is not a join link.
 */
export const readJoinLink = (raw: string): JoinLink | null => {
    try {
        const url = new URL(raw.trim());
        const token = url.searchParams.get('join') ?? url.searchParams.get('t');
        const farm = url.searchParams.get('farm') ?? url.searchParams.get('f');
        return token && farm ? { token, farm } : null;
    } catch {
        return null;
    }
};

/** The app's own QR landing page for that link (the SAME page a scanned QR opens). */
export const joinLandingHref = (link: JoinLink): string =>
    `/?join=${encodeURIComponent(link.token)}&farm=${encodeURIComponent(link.farm)}`;

/**
 * The one name of this door: on every button that opens it and in the owner's QR sheet ("type this
 * code"), so the words the owner reads out are the words on the joiner's screen. PROPOSED Marathi.
 */
export const JOIN_DOOR_LABEL = 'कोड किंवा QR ने सामील व्हा';

/*
 * Sign-in handoff. The login screen cannot send a code (the server answers only a signed-in
 * person), so its join button remembers the wish for THIS app session and the door opens by itself
 * right after sign-in. sessionStorage, like ProfilePage's `open_farm_boundary` handoff: it ends with
 * the app session and holds no personal data.
 */
const JOIN_AFTER_SIGN_IN_KEY = 'agrisync:join-after-sign-in';

export function rememberJoinAfterSignIn(): void {
    try {
        window.sessionStorage.setItem(JOIN_AFTER_SIGN_IN_KEY, '1');
    } catch {
        /* storage blocked: the person opens the door from the app instead */
    }
}

/** Reads AND clears the wish, so it opens the door once. */
export function takeJoinAfterSignIn(): boolean {
    try {
        const wanted = window.sessionStorage.getItem(JOIN_AFTER_SIGN_IN_KEY) === '1';
        if (wanted) window.sessionStorage.removeItem(JOIN_AFTER_SIGN_IN_KEY);
        return wanted;
    } catch {
        return false;
    }
}
