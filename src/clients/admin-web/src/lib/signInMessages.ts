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
  wrongPassword: 'The phone number or password is not right.',
  storageRefused:
    'This browser is blocking the console from remembering your sign-in. Allow site data for this site and try again.',
  notSent: 'The code could not be sent just now. Please try again in a little while.',
  wrongCode: 'That code is not right. Check the SMS and try again.',
  expiredCode: 'That code has expired. Send a new code.',
  noCodeWaiting: 'There is no code waiting for this number. Send a new code.',
  missingCode: 'Enter the code from the SMS.',
  tooMany: 'Too many tries. Please wait a while, then try again.',
  notCompleted: 'The sign-in could not be completed. Please start again.',
  questionClosed: 'This sign-in is no longer waiting for an answer. Send a new code to start again.',
  questionClosedPassword:
    'This sign-in is no longer waiting for an answer. Enter your password to start again.',
  answerNotSaved: 'Your answer could not be saved. Please try again.',
  declined:
    'You were not signed in, because you said this account is not yours. Check the phone number and try again.',
  newCodeSent: 'A new code has been sent.',
} as const;

// What the page says when the console itself signed the person out and sent them here.
const SIGNED_OUT_TEXT: Record<SessionEndReason, string> = {
  'max-age': `You were signed out after ${MAX_SESSION_HOURS} hours. Sign in again.`,
  ended: 'Your session has ended. Sign in again.',
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

export function sendCodeRefusalText(r: Refusal): string {
  if (r.unreachable) return TEXT.unreachable;
  if (r.status === 429) return r.message ?? TEXT.tooMany;
  // 400 is a number the server could not read, unless the SMS provider itself failed.
  if (r.status === 400) return r.code?.startsWith('msg91.') ? TEXT.notSent : TEXT.badPhone;
  return TEXT.wentWrong;
}

export function checkCodeRefusalText(r: Refusal): string {
  if (r.unreachable) return TEXT.unreachable;
  switch (r.status) {
    case 401:
      return TEXT.wrongCode;
    case 410:
      return TEXT.expiredCode;
    case 429:
      return r.message ?? TEXT.tooMany;
    case 404:
      return TEXT.noCodeWaiting;
    case 400:
      return r.code === 'otp.invalid_code' ? TEXT.missingCode : TEXT.badPhone;
    default:
      return TEXT.wentWrong;
  }
}

export function answerRefusalText(r: Refusal): string {
  if (r.unreachable) return TEXT.unreachable;
  if (r.status === 429) return r.message ?? TEXT.tooMany;
  return TEXT.answerNotSaved;
}

// The password way, in the code way's sentences. Nothing the server wrote is ever shown here:
// its 401 has no body, and its other refusals are not written for a person to read.
export function passwordRefusalText(r: Refusal): string {
  if (r.unreachable) return TEXT.unreachable;
  switch (r.status) {
    case 401:
      return TEXT.wrongPassword;
    case 429:
      return TEXT.tooMany;
    case 400:
      return TEXT.badPhone;
    default:
      return TEXT.wentWrong;
  }
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
