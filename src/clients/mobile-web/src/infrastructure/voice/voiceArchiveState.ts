// spec: 2026-08-25-prod-cutover-waves (voice archive path)
//
// The cloud-save state machine for ONE voice clip, as a pure function.
//
//   local_only  -> queued -> uploading -> acknowledged(server id)
//                               |
//                               v
//                            failed -> (retry) -> uploading ...
//
// THE RULE THIS FILE EXISTS FOR: a clip is `acknowledged` if and only if the
// SERVER echoed its id back after storing it (`s3RetainedKey` is that echoed
// id). Nothing else - not "the request was sent", not "the response was 200
// with a body we did not read", not "consent is on" - may produce the state
// the UI labels as saved to the cloud. Every other input resolves to a state
// that says, truthfully, that the phone holds the only copy.
//
// Pure on purpose: the Voice Diary renders from this, the uploader decides
// from this, and the tests pin it, so the three cannot drift apart.

import type { VoiceClipCacheRecord } from '../storage/DexieDatabase';

export type CloudArchiveState =
    /** Farmer does not keep his voice in the cloud. Nothing is pending, nothing is promised. */
    | 'local_only'
    /** Farmer keeps his voice; this clip is waiting for its upload. Phone holds the only copy. */
    | 'queued'
    /** A POST is in flight. Still NOT saved - only the server's reply makes it saved. */
    | 'uploading'
    /** The server stored it and echoed its id. The only state that may read as saved to the cloud. */
    | 'acknowledged'
    /** The last POST was not acknowledged. Will be retried; phone holds the only copy. */
    | 'failed';

/**
 * An `uploading` mark older than this is a crashed session's leftover, not a
 * live upload. It is read as `queued`, so a killed app cannot leave a clip
 * labelled "uploading" forever.
 */
export const STALE_UPLOADING_MS = 5 * 60 * 1000;

type StateInput = Pick<
    VoiceClipCacheRecord,
    's3RetainedKey' | 'archiveState' | 'retainedArchiveLastAttemptAtUtc'
>;

export function deriveCloudArchiveState(
    clip: StateInput,
    consentGranted: boolean,
    nowMs: number = Date.now(),
    /** False for a clip recorded before consent took effect: it is never queued. */
    eligible: boolean = true,
): CloudArchiveState {
    // The server's own echo beats every other signal, including later
    // revocation of consent: stopping FUTURE saving never un-saves a clip.
    if (clip.s3RetainedKey) return 'acknowledged';
    if (!consentGranted || !eligible) return 'local_only';
    if (clip.archiveState === 'uploading') {
        const startedMs = Date.parse(clip.retainedArchiveLastAttemptAtUtc ?? '');
        const live = Number.isFinite(startedMs) && nowMs - startedMs < STALE_UPLOADING_MS;
        return live ? 'uploading' : 'queued';
    }
    if (clip.archiveState === 'failed') return 'failed';
    return 'queued';
}

/** Seconds to wait before retrying after `failCount` consecutive failures: 15s, 30s ... capped at 10 min. */
export function archiveRetryDelayMs(failCount: number): number {
    const n = Math.max(1, Math.min(failCount, 6));
    return Math.min(15_000 * 2 ** (n - 1), 10 * 60 * 1000);
}

/**
 * True only when the failure was a TRANSPORT failure: the request never got an
 * answer (no connection, timeout, dropped). That is the one failure the farmer
 * can fix by getting the internet back, and the one for which "will try again
 * when the internet is working" is true. Any HTTP answer - even a 5xx - is not
 * connectivity.
 */
export function isTransportFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const e = error as { response?: unknown; code?: unknown; isAxiosError?: unknown; message?: unknown };
    if (e.response) return false;
    if (e.isAxiosError === true) return true;
    if (typeof e.code === 'string'
        && /^(ERR_NETWORK|ECONNABORTED|ETIMEDOUT|ECONNRESET|ENOTFOUND|ERR_INTERNET_DISCONNECTED)$/.test(e.code)) {
        return true;
    }
    return typeof e.message === 'string'
        && /network error|failed to fetch|networkerror|timeout of \d+ms exceeded|load failed/i.test(e.message);
}

/** Prefix the uploader writes into `retainedArchiveError` for a connectivity failure. */
export const NETWORK_FAILURE_PREFIX = 'network_failed';

/**
 * Why the last upload failed, as the farmer-facing message needs it:
 * `network` => the connectivity message (a retry IS coming);
 * `other`   => the plain "could not save" message with no retry promise.
 */
export function archiveFailureKind(clip: Pick<VoiceClipCacheRecord, 'retainedArchiveError'>): 'network' | 'other' {
    return typeof clip.retainedArchiveError === 'string' && clip.retainedArchiveError.startsWith(NETWORK_FAILURE_PREFIX)
        ? 'network'
        : 'other';
}
