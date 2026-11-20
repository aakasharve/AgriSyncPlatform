import { isAxiosError } from 'axios';
import { readSessionEndReason, type SessionEndReason } from './api';
import { MAX_SESSION_HOURS, type AdminSession } from './auth';

/**
 * The rules of the login page that need no page to run: which sentence answers which refusal,
 * what the page opens with after the console signed somebody out, when an answer really carries
 * a session, and how a wait is written.
 *
 * They were moved here from LoginPage.tsx exactly as they were, so that they can be tested
 * without React. "The page" and "this page" in the comments below mean the login page.
 */

// Every sentence either way in can show. Plain English: never a status number, never a raw error.
export const TEXT = {
  unreachable: 'The server could not be reached. Check your connection and try again.',
  wentWrong: 'Something went wrong. Please try again in a little while.',
  badPhone: 'That phone number does not look right. Enter a 10-digit mobile number.',
  storageRefused:
    'This browser is blocking the console from remembering your sign-in. Allow site data for this site and try again.',
  tooMany: 'Too many tries. Please wait a while, then try again.',
  notCompleted: 'The sign-in could not be completed. Please start again.',
  questionClosed: 'This sign-in is no longer waiting for an answer. Send a new code to start again.',
  answerNotSaved: 'Your answer could not be saved. Please try again.',
  declined:
    'You were not signed in, because you said this account is not yours. Check the phone number and try again.',
  // CR-3, the console's own door (D-155, D-155b). The same sentence for every number: it never says
  // whether a number is approved. Written out here once; the server's own `message` is not shown.
  doorCalm:
    'If this number is approved, a code is on its way. No code after a minute? Check the number, or ask Akash.',
  doorRefusedCode: 'That code did not work. Ask for a new code, or ask Akash.',
  doorPageLine: 'Sign in with your phone number. Only numbers Akash has approved can sign in.',
  doorUnderButton: 'No code is sent to a number that is not approved.',
  // H10: a team seat whose session did not begin at the door is ended and sent here.
  doorSessionRequired: 'Sign in again here, with a code sent to your phone.',
} as const;

// What the page says when the console itself signed the person out and sent them here.
const SIGNED_OUT_TEXT: Record<SessionEndReason, string> = {
  'max-age': `You were signed out after ${MAX_SESSION_HOURS} hours. Sign in again.`,
  ended: 'Your session has ended. Sign in again.',
  'door-required': TEXT.doorSessionRequired,
};

export function signedOutNotice(search: string = window.location.search): string | null {
  const reason = readSessionEndReason(search);
  return reason ? SIGNED_OUT_TEXT[reason] : null;
}

export interface Refusal {
  /** The HTTP status of the answer, or null when there was no answer. */
  status: number | null;
  /** True when the request got no answer at all (offline, timed out, blocked). */
  unreachable: boolean;
  /** The server's error code, e.g. "otp.mismatch". Used to choose a sentence, never shown. */
  code: string | null;
  /** The server's own sentence. Shown only for "too many" (429), and only on the code way. */
  message: string | null;
}

export function readRefusal(err: unknown): Refusal {
  if (!isAxiosError(err)) return { status: null, unreachable: false, code: null, message: null };
  if (!err.response) return { status: null, unreachable: true, code: null, message: null };
  const body = err.response.data as { error?: unknown; message?: unknown } | null | undefined;
  const code = typeof body?.error === 'string' ? body.error : null;
  const message =
    typeof body?.message === 'string' && body.message.trim() ? body.message.trim() : null;
  return { status: err.response.status, unreachable: false, code, message };
}

// The door's send-code (POST /shramsafal/admin/sign-in/send-code). Every valid number gets the
// same 200, so the only refusals are a number that cannot be read (400), too many tries (429),
// and a server that did not answer well. Nothing the server wrote is shown but its 429 sentence.
export function sendCodeRefusalText(r: Refusal): string {
  if (r.unreachable) return TEXT.unreachable;
  if (r.status === 429) return r.message ?? TEXT.tooMany;
  if (r.status === 400) return TEXT.badPhone;
  return TEXT.wentWrong;
}

// The door's check-code. Every refusal (401 `code_not_accepted`, or any other 4xx) is the one
// sentence, so a person learns nothing about why. No answer, too many tries and a server fault
// are not refusals of the code and say so.
export function checkCodeRefusalText(r: Refusal): string {
  if (r.unreachable) return TEXT.unreachable;
  if (r.status === 429) return r.message ?? TEXT.tooMany;
  if (r.status !== null && r.status >= 500) return TEXT.wentWrong;
  if (r.status === null) return TEXT.wentWrong;
  return TEXT.doorRefusedCode;
}

export function answerRefusalText(r: Refusal): string {
  if (r.unreachable) return TEXT.unreachable;
  if (r.status === 429) return r.message ?? TEXT.tooMany;
  return TEXT.answerNotSaved;
}

// A session is built only from an answer that really carries one.
export function toSession(
  data: { userId?: unknown; accessToken?: unknown; expiresAtUtc?: unknown } | null | undefined,
): AdminSession | null {
  if (!data) return null;
  const { userId, accessToken, expiresAtUtc } = data;
  if (typeof userId !== 'string' || !userId) return null;
  if (typeof accessToken !== 'string' || !accessToken) return null;
  if (typeof expiresAtUtc !== 'string' || !expiresAtUtc) return null;
  // No sign-in has a refresh token in this page: on the web it is a cookie the browser holds.
  return {
    accessToken,
    refreshToken: null,
    userId,
    expiresAtUtc,
    signedInAtUtc: new Date().toISOString(),
  };
}

export function formatWait(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} sec`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} sec`;
}
