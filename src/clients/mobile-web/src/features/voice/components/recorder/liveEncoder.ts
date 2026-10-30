/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane V-1, register F18) — the streaming recorder's sound,
 * encoded WHILE he speaks.
 *
 * The streaming recorder keeps raw PCM and encodes it to Opus only after the stop, by playing it through the browser
 * (`SegmentCompressor`) — in real time. For a 10-minute recording that is a 10-minute wait after the stop (and the
 * upload preparation re-encodes once more), and a phone that sleeps meanwhile can end the encode early. So the
 * recorder also runs this encoder on the same microphone stream from the start; a recording longer than
 * `LIVE_ENCODE_AFTER_SEC` is uploaded from it, ready the moment he stops. Shorter recordings keep today's path.
 *
 * It never throws: a browser that cannot encode here (no MediaRecorder, no WebM/Opus) gets `null` and the recorder's
 * own path, as before.
 */
import { SegmentCompressor } from '../../../../infrastructure/voice/SegmentCompressor';
import { DEFAULT_VOICE_CONFIG } from '../../../../infrastructure/voice/types';

export interface LiveEncoder {
    /** Ends the encoding; the whole recording as one WebM blob, or `null` when the encoder failed or heard nothing. */
    stop(): Promise<Blob | null>;
}

/** A chunk every second: what he said is held as he says it. */
const TIMESLICE_MS = 1000;

/**
 * Review B003 — the encoder's stop must answer, or the recorder's stop would wait forever. A stop with no answer by
 * then counts as a failed encoding (`null`): the recorder sends his sound its own way, never nothing.
 */
export const LIVE_STOP_TIMEOUT_MS = 3000;

export function startLiveEncoder(stream: MediaStream | null | undefined): LiveEncoder | null {
    if (!stream || typeof MediaRecorder === 'undefined') return null;
    const mimeType = SegmentCompressor.getSupportedMimeType();
    if (!mimeType) return null;
    try {
        const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: DEFAULT_VOICE_CONFIG.compression.targetBitrate });
        const chunks: Blob[] = [];
        let failed = false;
        recorder.ondataavailable = event => { if (event.data && event.data.size > 0) chunks.push(event.data); };
        recorder.onerror = () => { failed = true; };
        recorder.start(TIMESLICE_MS);
        const result = (): Blob | null => (failed || chunks.length === 0 ? null : new Blob(chunks, { type: 'audio/webm' }));
        return {
            stop: () => new Promise<Blob | null>(resolve => {
                let settled = false;
                const settle = (blob: Blob | null) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(blob);
                };
                // B003: no answer in time = a failed encoding (an incomplete file is never handed on as whole).
                const timer = setTimeout(() => { failed = true; settle(null); }, LIVE_STOP_TIMEOUT_MS);
                if (recorder.state === 'inactive') { settle(result()); return; }
                recorder.onstop = () => settle(result());
                try {
                    recorder.stop();
                } catch {
                    failed = true;
                    settle(null);
                }
            }),
        };
    } catch {
        return null;
    }
}
