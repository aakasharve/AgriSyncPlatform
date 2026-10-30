/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane V-1, register F18) — the upload material of a recording
 * the recorder encoded WHILE he spoke (`AudioData.encodedLive`, a recording longer than `LIVE_ENCODE_AFTER_SEC`).
 *
 * The usual preparation decodes the recording, trims its silences and re-encodes it — and that re-encode plays the
 * sound through the browser in real time (a 10-minute wait for a 10-minute recording). An already-encoded long
 * recording skips it: the bytes go exactly as recorded (the server cuts them into pieces), the content hash is taken
 * over those bytes, and both durations are the recorded length (nothing was trimmed, and the metadata says so).
 */
import type { AudioData } from '../../types';
import { ContentHasher } from '../../infrastructure/voice/ContentHasher';
import { VoiceIdempotency } from '../../infrastructure/voice/VoiceIdempotency';
import type { VoiceSessionMetadata } from '../../infrastructure/voice/types';
import type { PreprocessedAudioResult } from './useVoiceRecorder.types';

export interface LiveEncodedUpload {
    result: PreprocessedAudioResult;
    metadata: VoiceSessionMetadata;
    deterministicSeed: string;
}

export async function liveEncodedUpload(
    audioData: AudioData,
    ids: { userId?: string; farmId: string; sessionId: string },
): Promise<LiveEncodedUpload> {
    const contentHash = await ContentHasher.hashBlob(audioData.blob);
    const material = await VoiceIdempotency.buildSegmentMaterial({ ...ids, segmentIndex: 0, contentHash });
    const ms = Math.max(0, Math.round(audioData.durationMs ?? 0));
    const metadata: VoiceSessionMetadata = {
        sessionId: ids.sessionId,
        farmId: ids.farmId,
        totalSegments: 1,
        totalSpeechDurationMs: ms,
        totalRawDurationMs: ms,
        totalSilenceRemovedMs: 0,
        compressionRatio: 1,
        deviceTimestamp: new Date().toISOString(),
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    const segmentMetadata = {
        sessionId: ids.sessionId,
        farmId: ids.farmId,
        totalSegments: 1,
        totalSpeechDurationMs: ms,
        totalRawDurationMs: ms,
        totalSilenceRemovedMs: 0,
    };
    return {
        result: {
            base64: audioData.base64,
            mimeType: audioData.mimeType,
            ...(ms > 0 && { inputSpeechDurationMs: ms, inputRawDurationMs: ms }),
            segmentMetadataJson: JSON.stringify(segmentMetadata),
            idempotencyKey: material.deterministicKey,
            requestPayloadHash: contentHash,
        },
        metadata,
        deterministicSeed: material.deterministicSeed,
    };
}
