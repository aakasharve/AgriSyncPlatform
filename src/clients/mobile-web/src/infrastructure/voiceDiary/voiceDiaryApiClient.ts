// spec: voice-diary-e2e-2026-05-17 (D.5)
//
// Voice Diary API client — calls the three retained-tier endpoints
// added by Wave 1.B:
//
//   POST /shramsafal/voice-diary/persist        — archive a sealed clip
//   GET  /shramsafal/voice-diary/by-range       — list clips in a window
//   GET  /shramsafal/voice-diary/by-id/{clipId} — fetch one clip + bytes
//
// (Note: the comments in the backend's VoiceDiaryEndpoints.cs say
// `/api/voice-diary/*` but the actual mount in ModuleEndpoints.cs is
// under the `/shramsafal` route group. The wire path is `/shramsafal/...`.)
//
// All three are bearer-token authorized. The client uses the shared
// axios instance via `agriSyncClient.http`-equivalent access through
// the BackendAiClient extension layer. We define typed wrappers + Zod
// runtime validation at the wire boundary to fail closed on a server
// shape drift.
//
// The `clipId` on the wire is the ARCHIVE id: a Guid derived
// deterministically from the local Dexie `voiceClips.id` by
// `toArchiveClipId` (the local id is a 64-hex SHA-256 string; the server
// column, route and object key are Guid-typed). Callers pass the archive id;
// `buildPersistRequestBody` refuses anything that is not a Guid BEFORE the
// network, so a contract drift fails in the unit suite, not as a production 500.
// The unified VoiceDiary view de-dupes local and cloud clips by mapping the
// archive id back through the same function.

import { z } from 'zod';
import { agriSyncClient } from '../api/AgriSyncClient';
import { isGuidString } from '../voice/archiveClipId';

// ---------------------------------------------------------------------------
// Wire shapes (mirror VoiceDiaryEndpoints.cs / RetainedClipResult /
// VoiceClipRetainedListItem on the .NET side).
// ---------------------------------------------------------------------------

export interface PersistVoiceClipRetainedRequest {
    /** ARCHIVE id (a Guid): `toArchiveClipId(voiceClips.id)`. Never the raw local id. */
    clipId: string;
    /** ISO-8601 UTC timestamp of the original recording. */
    recordedAtUtc: string;
    /** Base64 AES-GCM ciphertext WITHOUT the trailing 16-byte auth tag. */
    cipherBase64: string;
    /** Opaque DEK identifier from `tenantDekClient.getCurrentTenantDek`. */
    dekId: string;
    /** Base64 96-bit IV used during the seal. */
    ivBase64: string;
    /** Base64 16-byte AES-GCM auth tag (split from the WebCrypto output). */
    authTagBase64: string;
    /** Whole-seconds duration. Backend invariant requires >= 1. */
    durationSeconds: number;
    /** BCP-47 locale the app offers. Hindi was removed; 'hi' can never be sent. */
    language: ArchiveLanguage;
}

/** Languages the app offers (Marathi, English). The server stores any <=16-char tag. */
export type ArchiveLanguage = 'mr-IN' | 'en-IN';
const ARCHIVE_LANGUAGES: readonly string[] = ['mr-IN', 'en-IN'];

/**
 * Column limits of `ssf.voice_clips_retained` (VoiceClipRetainedConfiguration):
 * iv_b64 64, auth_tag_b64 64, language 16, dek_id 512 (widened from 128 because
 * a real KMS-wrapped DEK id is ~248 chars). A longer value is a Postgres 22001
 * = HTTP 500 on the server; refusing it here makes it a named client failure.
 */
const MAX_DEK_ID = 512;
const MAX_IV_B64 = 64;
const MAX_TAG_B64 = 64;
/** Server ceiling on the base64 ciphertext (VoiceDiaryEndpoints.MaxCipherPayloadBase64Bytes). */
const MAX_CIPHER_B64 = 16 * 1024 * 1024;
const STANDARD_B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function requireBase64(name: string, value: unknown, max: number): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > max || !STANDARD_B64.test(value)) {
        throw new Error(`voiceDiaryApiClient: ${name} must be non-empty standard base64 of at most ${max} chars.`);
    }
    return value;
}

/**
 * THE function that serialises the persist body. `persistRetainedVoiceClip`
 * POSTs exactly what this returns, and the cross-stack contract test feeds the
 * same JSON to the real ASP.NET endpoint. Field names are the camelCase form of
 * `PersistVoiceDiaryRequest`; `recordedAtUtc` is a UTC ISO-8601 instant (the
 * server field is DateTime), `durationSeconds` a whole number >= 1 (server int).
 */
export function buildPersistRequestBody(request: PersistVoiceClipRetainedRequest): Record<string, string | number> {
    if (typeof request.clipId !== 'string' || !isGuidString(request.clipId)) {
        throw new Error('voiceDiaryApiClient: clipId must be the archive Guid (toArchiveClipId), not a local clip id.');
    }
    const recordedAtMs = Date.parse(request.recordedAtUtc);
    if (!Number.isFinite(recordedAtMs)) {
        throw new Error('voiceDiaryApiClient: recordedAtUtc must be an ISO-8601 instant.');
    }
    if (!Number.isInteger(request.durationSeconds) || request.durationSeconds < 1) {
        throw new Error('voiceDiaryApiClient: durationSeconds must be a whole number of at least 1.');
    }
    if (!ARCHIVE_LANGUAGES.includes(request.language)) {
        throw new Error(`voiceDiaryApiClient: language must be one of ${ARCHIVE_LANGUAGES.join(', ')}.`);
    }
    if (typeof request.dekId !== 'string' || request.dekId.trim().length === 0 || request.dekId.length > MAX_DEK_ID) {
        throw new Error(`voiceDiaryApiClient: dekId must be non-empty and at most ${MAX_DEK_ID} chars.`);
    }
    return {
        clipId: request.clipId.trim().toLowerCase(),
        recordedAtUtc: new Date(recordedAtMs).toISOString(),
        cipherBase64: requireBase64('cipherBase64', request.cipherBase64, MAX_CIPHER_B64),
        dekId: request.dekId,
        ivBase64: requireBase64('ivBase64', request.ivBase64, MAX_IV_B64),
        authTagBase64: requireBase64('authTagBase64', request.authTagBase64, MAX_TAG_B64),
        durationSeconds: request.durationSeconds,
        language: request.language,
    };
}

export interface PersistVoiceClipRetainedResponse {
    /** Echoes the clipId; the server may reassign on collision (today: PK reuse). */
    clipId: string;
}

export interface VoiceDiaryListItem {
    clipId: string;
    recordedAtUtc: string;
    durationSeconds: number;
    language: string;
    s3Key: string;
}

export interface VoiceDiaryByIdResult {
    clipId: string;
    recordedAtUtc: string;
    durationSeconds: number;
    language: string;
    dekId: string;
    ivBase64: string;
    authTagBase64: string;
    cipherBase64: string;
}

// ---------------------------------------------------------------------------
// Zod runtime validators (defence in depth — the wire boundary is the
// last place we can stop a server shape drift).
// ---------------------------------------------------------------------------

export const PersistResponseSchema = z.object({
    clipId: z.string().min(1),
});

const ListItemSchema = z.object({
    clipId: z.string().min(1),
    recordedAtUtc: z.string(),
    durationSeconds: z.number().int().nonnegative(),
    language: z.string(),
    s3Key: z.string(),
});

export const RangeResponseSchema = z.object({
    clips: z.array(ListItemSchema),
});

export const ByIdSchema = z.object({
    clipId: z.string().min(1),
    recordedAtUtc: z.string(),
    durationSeconds: z.number().int().nonnegative(),
    language: z.string(),
    dekId: z.string(),
    ivBase64: z.string(),
    authTagBase64: z.string(),
    cipherBase64: z.string(),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Archive a sealed voice clip to the retained S3 tier.
 *
 * The backend gates this on `IConsentEnforcer.RequireGrantAsync(userId,
 * ConsentPurpose.FullHistoryJournal)`; on deny it returns 400 with
 * `error: ShramSafal.ConsentRequired` and the call rejects.
 *
 * The caller MUST split the WebCrypto AES-GCM combined output:
 *   - ciphertext = ct[0 .. ct.length - 16]   → cipherBase64
 *   - authTag    = ct[ct.length - 16 .. end] → authTagBase64
 *
 * See `archiveToRetainedTierIfConsented` in
 * `infrastructure/voice/VoiceClipRetention.ts` for the canonical caller.
 */
export async function persistRetainedVoiceClip(
    request: PersistVoiceClipRetainedRequest,
): Promise<PersistVoiceClipRetainedResponse> {
    const axiosClient = agriSyncClient.http;
    const response = await axiosClient.post<unknown>(
        '/shramsafal/voice-diary/persist',
        buildPersistRequestBody(request),
    );

    const parsed = PersistResponseSchema.safeParse(response.data);
    if (!parsed.success) {
        throw new Error(
            `voiceDiaryApiClient.persistRetainedVoiceClip: invalid response shape — ${parsed.error.toString()}`,
        );
    }
    return parsed.data;
}

/**
 * Fetch retained-tier clip metadata in a date window. Server-side
 * scopes to the caller's userId; no farmId required.
 */
export async function getVoiceDiaryByRange(
    fromDate: string,
    toDate: string,
): Promise<VoiceDiaryListItem[]> {
    const axiosClient = agriSyncClient.http;
    const response = await axiosClient.get<unknown>('/shramsafal/voice-diary/by-range', {
        params: { from: fromDate, to: toDate },
    });

    const parsed = RangeResponseSchema.safeParse(response.data);
    if (!parsed.success) {
        throw new Error(
            `voiceDiaryApiClient.getVoiceDiaryByRange: invalid response shape — ${parsed.error.toString()}`,
        );
    }
    return parsed.data.clips;
}

/**
 * Fetch a single retained clip with its ciphertext bytes. The caller
 * resolves the DEK via `resolveDek(dekId)` from `tenantDekClient` and
 * passes both into `voiceEnvelope.openVoiceClip` to recover plaintext.
 *
 * Returns null when the server responds 404 (clip not found OR not
 * owned by the caller — the endpoint conflates both for privacy).
 */
export async function getVoiceDiaryById(clipId: string): Promise<VoiceDiaryByIdResult | null> {
    // The route is `{clipId:guid}`: a non-Guid can never match, so refuse it here
    // instead of asking the server a question it answers with a bare 404.
    if (!isGuidString(clipId)) {
        throw new Error('voiceDiaryApiClient.getVoiceDiaryById: clipId must be the archive Guid.');
    }
    const axiosClient = agriSyncClient.http;
    try {
        const response = await axiosClient.get<unknown>(`/shramsafal/voice-diary/by-id/${encodeURIComponent(clipId)}`);
        const parsed = ByIdSchema.safeParse(response.data);
        if (!parsed.success) {
            throw new Error(
                `voiceDiaryApiClient.getVoiceDiaryById: invalid response shape — ${parsed.error.toString()}`,
            );
        }
        return parsed.data;
    } catch (error) {
        // Axios threw — peek at the response for a 404 to surface as `null`.
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 404) {
            return null;
        }
        throw error;
    }
}
