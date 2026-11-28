/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-instant-phase-a-2026-11-23 (Task 0, phone half) — where the time goes after he taps stop, measured on the
 * phone, one `voice_timing` record per recording (E6: no speed claim without this measurement).
 *
 *   stop → ack          the recording is written on this phone (the clip row; `noteVoiceJourney` 'kept')
 *   stop → upload start the request leaves for the server
 *   upload              the bytes reach the server (the request's own upload progress)
 *   server              the `Server-Timing` header's `total` (absent until the server lane ships it: then simply omitted)
 *   stop → result       the answer is back
 *
 * Only the INTERACTIVE parse is measured: a recording that has a stop, a phone write and then its request, in that
 * order. A job the offline queue sends hours later has no phone write after a stop in this session, so it records
 * nothing. The timeline is wiped when a request ends, however it ends, so one recording's marks never reach the next.
 *
 * The record goes to the console (`logger.info('voice_timing', …)`, readable over remote debugging and adb) — NOT to
 * the analytics outbox: that ingest answers 400 to an event type outside its frozen vocabulary and the outbox then
 * deletes the WHOLE batch, real closure events included. Adding `voice_timing` to the vocabulary is a server change
 * (`EventVocabulary.cs` + `eventSchema.ts` + its ADR); until then it stays here.
 *
 * Display/measurement only: nothing here can throw into the voice path or change what is sent.
 */
import { logger } from '../observability/Logger';

export type VoiceStage = 'stop' | 'ack' | 'upload-start' | 'upload-done';

/** `performance.now()` of each stage of the recording in flight. A new stop starts a new recording. */
let timeline: Partial<Record<VoiceStage, number>> = {};

const clock = (): number => {
    try { return performance.now(); } catch { return Date.now(); }
};

/** Marks a stage now: the timeline for this module, and a `voice:<stage>` mark for the browser's own performance tools. */
export function markVoice(stage: VoiceStage): void {
    if (stage === 'stop') timeline = {};
    timeline[stage] = clock();
    try { performance.mark(`voice:${stage}`); } catch { /* observability-only */ }
}

/** The request's own upload progress: the upload is done when every byte has been handed over (once). */
export function noteUploadProgress(progress: { loaded?: number; total?: number }): void {
    if (timeline['upload-done'] !== undefined) return;
    const { loaded, total } = progress;
    if (typeof loaded === 'number' && typeof total === 'number' && total > 0 && loaded >= total) markVoice('upload-done');
}

/** Wipes the timeline (a request ended, or a recording was dropped). */
export function endVoiceTiming(): void {
    timeline = {};
}

export type ServerStage = 's3' | 'stt' | 'struct' | 'total';

/**
 * `Server-Timing: s3;dur=120, stt;dur=2400, struct;dur=3100, total;dur=5800` → `{ s3: 120, stt: 2400, … }`. Only the
 * four stages the server names, only non-negative numbers; anything else is ignored (an unknown or malformed header
 * gives `{}`).
 */
export function parseServerTiming(header: unknown): Partial<Record<ServerStage, number>> {
    const out: Partial<Record<ServerStage, number>> = {};
    if (typeof header !== 'string') return out;
    for (const metric of header.split(',')) {
        const [name, ...params] = metric.trim().split(';');
        const key = name?.trim().toLowerCase() as ServerStage;
        if (key !== 's3' && key !== 'stt' && key !== 'struct' && key !== 'total') continue;
        const dur = params.map(p => p.trim().match(/^dur=([0-9]+(?:\.[0-9]+)?)$/i)?.[1]).find(Boolean);
        if (dur !== undefined) out[key] = Math.round(Number(dur));
    }
    return out;
}

/** The `Server-Timing` header off an axios (or fetch-like) headers object, whichever shape it is. */
function readServerTimingHeader(headers: unknown): unknown {
    if (!headers || typeof headers !== 'object') return undefined;
    const h = headers as { get?: (name: string) => unknown } & Record<string, unknown>;
    try {
        if (typeof h.get === 'function') return h.get('server-timing') ?? undefined;
    } catch { /* fall through to the plain object */ }
    return h['server-timing'] ?? h['Server-Timing'];
}

type MemoryClass = 'low' | 'mid' | 'high' | 'unknown';

/** "Low" is the phones the founder is worried about: 3 GB or less (the plan's low-end line). */
function memoryClass(): MemoryClass {
    const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (typeof gb !== 'number' || !Number.isFinite(gb)) return 'unknown';
    return gb <= 3 ? 'low' : gb <= 6 ? 'mid' : 'high';
}

function networkType(): string {
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string; type?: string } }).connection;
    return connection?.effectiveType ?? connection?.type ?? 'unknown';
}

export interface VoiceTimingRecord {
    stopToAckMs: number;
    stopToUploadStartMs: number;
    uploadMs?: number;
    serverMs?: number;
    serverStagesMs?: Partial<Record<Exclude<ServerStage, 'total'>, number>>;
    stopToResultMs: number;
    recordingMs?: number;
    networkType: string;
    memoryClass: MemoryClass;
}

/**
 * The answer is back: builds the record for this recording, writes it to the console and returns it — or returns null
 * when this request was not the interactive parse of a recording (no stop, no phone write, wrong order).
 */
export function finishVoiceTiming(headers: unknown, extras: { recordingMs?: number } = {}): VoiceTimingRecord | null {
    try {
        const { stop, ack } = timeline;
        const start = timeline['upload-start'];
        if (stop === undefined || ack === undefined || start === undefined || ack < stop || start < ack) return null;
        const done = timeline['upload-done'];
        const now = clock();
        const server = parseServerTiming(readServerTimingHeader(headers));
        const { total, ...stages } = server;
        const record: VoiceTimingRecord = {
            stopToAckMs: Math.round(ack - stop),
            stopToUploadStartMs: Math.round(start - stop),
            ...(done !== undefined && done >= start && { uploadMs: Math.round(done - start) }),
            ...(total !== undefined && { serverMs: total }),
            ...(Object.keys(stages).length > 0 && { serverStagesMs: stages }),
            stopToResultMs: Math.round(now - stop),
            ...(typeof extras.recordingMs === 'number' && extras.recordingMs >= 0 && { recordingMs: Math.round(extras.recordingMs) }),
            networkType: networkType(),
            memoryClass: memoryClass(),
        };
        try { performance.mark('voice:result'); } catch { /* observability-only */ }
        logger.info('voice_timing', { ...record });
        lastRecord = record;
        return record;
    } catch {
        return null;
    }
}

/** The last finished record, kept until the NEXT voice upload carries it to the server's log (once). */
let lastRecord: VoiceTimingRecord | null = null;

/**
 * spec plr-d10 (voice AI review, 28 Nov 2026) — the phone's numbers for the PREVIOUS recording, as one short line for the next
 * voice upload to carry (a plain form field, `client_timing_prev`, which a server that does not know it ignores — never a header, which
 * the CORS allow-list would refuse in preflight). The server writes it into its own `[voice-timing]` log line, so ONE file holds the
 * whole chain of a recording: stop, phone write, upload, server (S3, speech-to-text, structuring) and the answer back. Returns it once,
 * then null until another recording finishes. Display/measurement only: it carries no words, ids or place, only milliseconds, the
 * connection kind and a memory class.
 */
export function takePreviousTimingForUpload(): string | null {
    const r = lastRecord;
    lastRecord = null;
    if (!r) return null;
    const parts: Array<[string, number | string | undefined]> = [
        ['stopToAck', r.stopToAckMs], ['stopToUpload', r.stopToUploadStartMs], ['upload', r.uploadMs], ['server', r.serverMs],
        ['s3', r.serverStagesMs?.s3], ['stt', r.serverStagesMs?.stt], ['struct', r.serverStagesMs?.struct],
        ['stopToResult', r.stopToResultMs], ['recording', r.recordingMs], ['net', r.networkType], ['mem', r.memoryClass],
    ];
    return parts.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(',');
}

export function resetVoiceTimingForTests(): void {
    timeline = {};
    lastRecord = null;
}
