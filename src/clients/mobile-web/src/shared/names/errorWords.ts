/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I18) — an error, said the farmer's way in his language. The
 * server answers a refusal as `{ error: "<Context>.<Code>", message: "<English description>" }` (ToErrorResult in the
 * API endpoints) and the HTTP client throws "Request failed with status code 403": neither is ever shown as it is.
 * The error is read by its CODE (or status, or "no network") into one of a few kinds, and each kind has one plain
 * sentence in Marathi and its English twin. Every sentence here is PROPOSED (Marathi) / PROPOSED (English).
 */

export type ErrorKind = 'offline' | 'permission' | 'notFound' | 'conflict' | 'invalid' | 'signIn' | 'server' | 'generic';

export const ERROR_WORDS: Readonly<Record<ErrorKind, { mr: string; en: string }>> = {
    offline: { mr: 'इंटरनेट नाही. इंटरनेट आलं की पुन्हा प्रयत्न करा.', en: 'No internet. Try again when you are online.' },
    permission: { mr: 'हे करण्याची परवानगी तुम्हाला नाही. शेताच्या मालकाला विचारा.', en: 'You do not have permission to do this. Ask the farm owner.' },
    notFound: { mr: 'हे आता सापडत नाही — कदाचित काढलं गेलं आहे.', en: 'This could not be found — it may have been removed.' },
    conflict: { mr: 'हे आधीच झालं आहे किंवा दुसऱ्या फोनवर बदललं आहे. पुन्हा उघडून पाहा.', en: 'This was already done or changed on another phone. Open it again to check.' },
    invalid: { mr: 'काहीतरी अपुरं किंवा चुकीचं भरलं आहे. तपासून पुन्हा पाठवा.', en: 'Something is missing or not right. Check it and send again.' },
    signIn: { mr: 'पुन्हा लॉग इन करा.', en: 'Please log in again.' },
    server: { mr: 'सर्व्हरवर अडचण आहे. थोड्या वेळाने पुन्हा प्रयत्न करा.', en: 'The server has a problem. Try again in a little while.' },
    generic: { mr: 'काहीतरी चुकलं. पुन्हा प्रयत्न करा.', en: 'Something went wrong. Please try again.' },
};

/** A server / client error code ("ShramSafal.Forbidden", "Invite.Expired", "audio_read_failed") → its kind. */
export function kindOfCode(code: string): ErrorKind | null {
    const c = code.trim();
    if (!c) return null;
    if (/forbidden|notallowed|not_allowed|permission|denied/i.test(c)) return 'permission';
    if (/notfound|not_found|missing$/i.test(c)) return 'notFound';
    if (/conflict|already|duplicate|stale|version/i.test(c)) return 'conflict';
    if (/unauthenticated|unauthori[sz]ed|token|session/i.test(c)) return 'signIn';
    if (/invalid|validation|required|toolong|too_long|format/i.test(c)) return 'invalid';
    if (/network|offline|timeout/i.test(c)) return 'offline';
    return null;
}

const kindOfStatus = (status: number): ErrorKind | null => {
    if (status === 401) return 'signIn';
    if (status === 403) return 'permission';
    if (status === 404) return 'notFound';
    if (status === 409 || status === 412) return 'conflict';
    if (status === 400 || status === 422) return 'invalid';
    if (status >= 500) return 'server';
    return null;
};

interface HttpLike { response?: { status?: number; data?: unknown }; request?: unknown; code?: string; message?: string }

/** What kind of failure this is — read from its code first, then its HTTP status, then "no network". */
/** Only a word without spaces is read as a code: a sentence is never guessed at ("invite token expired" is not "log in"). */
const asCode = (text: string): ErrorKind | null => (text && !/\s/.test(text.trim()) ? kindOfCode(text) : null);

export function errorKindOf(error: unknown): ErrorKind {
    if (typeof error === 'string') return asCode(error) ?? 'generic';
    if (!error || typeof error !== 'object') return 'generic';
    const e = error as HttpLike;
    const data = e.response?.data as { error?: unknown; code?: unknown } | undefined;
    const code = typeof data?.error === 'string' ? data.error : typeof data?.code === 'string' ? data.code : '';
    const byCode = code ? kindOfCode(code) : null;
    if (byCode) return byCode;
    if (typeof e.response?.status === 'number') return kindOfStatus(e.response.status) ?? 'generic';
    if (e.code === 'ERR_NETWORK' || e.message === 'Network Error' || (e.request && !e.response)) return 'offline';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    return (e.message && asCode(e.message)) || 'generic';
}

/** The farmer's sentence for this error, in his language (Marathi unless the app is in English). */
export const farmerErrorText = (error: unknown, language: string | null | undefined): string =>
    ERROR_WORDS[errorKindOf(error)][language === 'en' ? 'en' : 'mr'];
