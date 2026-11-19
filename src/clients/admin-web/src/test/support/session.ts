/**
 * The words the tests share about a stored sign-in: where the browser keeps things (the three
 * keys below come from the rules, not from the code) and how a session is written down.
 */

import type { FakeStore } from './browser';

/** Where the session is kept in the browser's store. */
export const SESSION_KEY = 'admin.session.v1';

/** Where the mark "a sign-out is owed to the server" is kept. Its value is the text "1". */
export const SIGN_OUT_OWED_KEY = 'admin.signout.owed.v1';

/** Where this browser's own id is kept. */
export const DEVICE_KEY = 'admin.device.v1';

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** A fixed moment the tests count from. A whole second, like the times a server sends. */
export const NOON = Date.UTC(2026, 5, 15, 12, 0, 0);

/** The moment as the text the console stores: `2026-06-15T12:00:00.000Z`. */
export function at(ms: number): string {
  return new Date(ms).toISOString();
}

/** The user id of the person who is signed in, in the tests that have one. */
export const PERSON = 'a3f1c2d4-0000-4000-8000-00000000abcd';

/** A session as the browser's store holds it. */
export interface StoredSession {
  accessToken: string;
  refreshToken: string | null;
  userId: string;
  expiresAtUtc: string;
  signedInAtUtc: string;
}

/**
 * The person's session as it stands at `nowMs`. Unless said otherwise: signed in two hours ago,
 * with an access token that has ten minutes left.
 */
export function sessionAt(
  nowMs: number,
  parts: { token?: string; tokenLeftMs?: number; signedInAgoMs?: number } = {},
): StoredSession {
  return {
    accessToken: parts.token ?? 'token-in-store',
    refreshToken: null,
    userId: PERSON,
    expiresAtUtc: at(nowMs + (parts.tokenLeftMs ?? 10 * MINUTE)),
    signedInAtUtc: at(nowMs - (parts.signedInAgoMs ?? 2 * HOUR)),
  };
}

/**
 * What the server answers to a renewal it accepts at `nowMs`: a new access token for the person,
 * good for fifteen minutes. (The new refresh token travels as a cookie, not in this body.)
 */
export function renewedAt(
  nowMs: number,
  token: string = 'token-new',
): { userId: string; accessToken: string; expiresAtUtc: string } {
  return { userId: PERSON, accessToken: token, expiresAtUtc: at(nowMs + 15 * MINUTE) };
}

/** Writes the session into the store, as a sign-in would have left it. */
export function keepSession(store: FakeStore, session: StoredSession): StoredSession {
  store.put(SESSION_KEY, JSON.stringify(session));
  return session;
}

/** The session the store holds now, or null when it holds none. */
export function keptSession(store: FakeStore): StoredSession | null {
  const text = store.peek(SESSION_KEY);
  return text === null ? null : (JSON.parse(text) as StoredSession);
}
