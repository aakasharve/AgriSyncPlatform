// Module-level helpers and types extracted from BackendAiClient.ts to keep that
// file under the 800-line mobile-web size budget (Sub-plan 04 §DoD). Pure code
// move — no behavior change. BackendAiClient re-exports `safeTrim` for the
// existing `__tests__/safeTrim.test.ts` import.
import { getDatabase } from '../storage/DexieDatabase';
import { SessionStore } from '../storage/SessionStore';
import { getAuthSession } from '../storage/AuthTokenStore';
import { getLastCachedMeContext } from '../../core/session/MeContextService';

// voice-safetrim-harden-2026-06-10 — a .trim() on a non-string (response/input
// field that's unexpectedly a number/object) was throwing "x.trim is not a
// function" and blocking voice logs. Coerce safely + log the culprit so the
// real offending field is visible in the console for a precise follow-up.
export function safeTrim(value: unknown, label: string): string {
    if (typeof value === 'string') return value.trim();
    if (value !== null && value !== undefined) {
        console.warn(`[voice-safetrim] non-string passed to .trim() at "${label}":`, typeof value, value);
    }
    return '';
}

export type VoiceUploadMaterial = {
    audioBlob: Blob;
    mimeType: string;
    idempotencyKey: string;
    requestPayloadHash: string;
    inputSpeechDurationMs?: number;
    inputRawDurationMs?: number;
    segmentMetadataJson?: string;
    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix (Option B):
    // forwarded as the multipart `recorded_at` form field by
    // agriSyncClient.parseVoiceLog. ISO-8601 UTC. Omitted when the
    // input carried no recording timestamp — server falls back to
    // null and the structurer prompt substitutes "unknown".
    recordedAtUtc?: string;
};

export function normalizeSuggestedAction(action?: string): 'auto_confirm' | 'manual_review' | 'ask_clarification' {
    const normalized = safeTrim(action, 'suggestedAction').toLowerCase();
    if (normalized === 'auto_confirm') return 'auto_confirm';
    if (normalized === 'ask_clarification') return 'ask_clarification';
    return 'manual_review';
}

// ROBUSTNESS_2026-06-10 (Option A — unblock; proper contract alignment = follow-up B).
// The backend's legacy-prompt parsedLog (promptVersion legacy-2026-02-22) drifts from
// the strict AgriLogResponseSchema: event items omit `id`, `confidence` is a scalar, and
// extra `_meta`/`fieldConfidences` keys are present. Discarding the whole parse blocks the
// farmer entirely. This generates the missing event ids so the parse renders on the
// confirm screen; it is PURE shape-normalization (never invents/changes content). The
// human confirm-step is the integrity gate. Does NOT touch the schema (shared contract).
export function normalizeDriftedParsedLog(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object') return raw;
    const genId = (): string =>
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
            ? crypto.randomUUID()
            : `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const withIds = (value: unknown): unknown =>
        Array.isArray(value)
            ? value.map(item =>
                (item && typeof item === 'object' && !(item as { id?: unknown }).id)
                    ? { ...(item as object), id: genId() }
                    : item)
            : value;
    const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    for (const key of ['cropActivities', 'irrigation', 'labour', 'inputs', 'machinery', 'activityExpenses', 'observations', 'plannedTasks']) {
        if (key in out) out[key] = withIds(out[key]);
    }
    return out;
}

export async function resolveFarmIdFromCache(): Promise<string | undefined> {
    // 1) Authoritative source: the current farm from the session. It is set when
    //    the farm context loads on login and persists to localStorage. The
    //    LogContext selection objects do NOT carry a farmId, and the sync-pull
    //    payload cache below is empty for a freshly-linked user — so without this
    //    the parse failed with "No farm context available for AI parsing." even
    //    with a crop + plot selected. (2026-06-08 root-cause fix.)
    const sessionFarmId = safeTrim(SessionStore.getCurrentFarmId(), 'sessionFarmId');
    if (sessionFarmId.length > 0) {
        return sessionFarmId;
    }

    // 2) The /user/auth/me/context aggregate (the caller's farms), cached in memory.
    const meFarmId = getLastCachedMeContext()?.farms?.find(
        farm => typeof farm.farmId === 'string' && farm.farmId.trim().length > 0,
    )?.farmId;
    if (meFarmId) {
        return meFarmId;
    }

    const db = getDatabase();

    const cachedPayload = await db.appMeta.get('shramsafal_last_pull_payload');
    const farms = (cachedPayload?.value as { farms?: Array<{ id?: string }> } | undefined)?.farms ?? [];
    const firstFarmId = farms.find(farm => typeof farm.id === 'string' && farm.id.length > 0)?.id;
    if (firstFarmId) {
        return firstFarmId;
    }

    const firstDayLedger = await db.dayLedgers.toCollection().first();
    return firstDayLedger?.farmId;
}

// DATA_PRINCIPLE_SPINE 02.6 — the legacy `isRecord` / `isAgriLogResponse`
// shallow type guards previously gated the parse boundary here. They
// were removed in favor of `AgriLogResponseSchema.safeParse` (Zod,
// strict + enum-checked). `GeminiClient` still uses its own copy of
// the legacy guard during the transitional period — once that path
// is also migrated, the guard can be deleted from this codebase.

export function base64ToBlob(base64: string, mimeType: string): Blob {
    const normalized = base64.includes(',') ? base64.split(',')[1] : base64;
    const binaryString = atob(normalized);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);

    for (let i = 0; i < length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    return new Blob([bytes], { type: mimeType });
}

export function resolveUserIdFromSession(): string {
    const session = getAuthSession();
    const userId = safeTrim(session?.userId, 'userId');
    if (userId.length > 0) {
        return userId;
    }

    return 'unknown-user';
}

function getAudioContextCtor(): typeof AudioContext | null {
    if (typeof AudioContext !== 'undefined') {
        return AudioContext;
    }

    const maybeWindow = typeof window !== 'undefined'
        ? (window as unknown as { webkitAudioContext?: typeof AudioContext })
        : undefined;
    return maybeWindow?.webkitAudioContext ?? null;
}

export async function estimateAudioDurationMs(audioBlob: Blob): Promise<number | undefined> {
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
        return undefined;
    }

    const audioContext = new AudioContextCtor();
    try {
        const audioBuffer = await audioContext.decodeAudioData(await audioBlob.arrayBuffer());
        return Math.round((audioBuffer.length / audioBuffer.sampleRate) * 1000);
    } catch {
        return undefined;
    } finally {
        await audioContext.close().catch(() => {});
    }
}

export function buildVoiceSessionMetadataJson(params: {
    sessionId: string;
    farmId: string;
    inputSpeechDurationMs?: number;
    inputRawDurationMs?: number;
}): string | undefined {
    const speech = params.inputSpeechDurationMs ?? params.inputRawDurationMs;
    const raw = params.inputRawDurationMs ?? params.inputSpeechDurationMs;
    if (speech === undefined && raw === undefined) {
        return undefined;
    }

    const safeSpeech = speech ?? 0;
    const safeRaw = raw ?? safeSpeech;
    const metadata = {
        sessionId: params.sessionId,
        farmId: params.farmId,
        totalSegments: 1,
        totalSpeechDurationMs: safeSpeech,
        totalRawDurationMs: safeRaw,
        totalSilenceRemovedMs: Math.max(0, safeRaw - safeSpeech),
        compressionRatio: 1,
        deviceTimestamp: new Date().toISOString(),
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    return JSON.stringify(metadata);
}
