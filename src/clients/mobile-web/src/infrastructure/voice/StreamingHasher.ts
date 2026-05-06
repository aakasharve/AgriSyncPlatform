/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VOICE_LATENCY_PIPELINE_V2 Phase 2 — incremental hasher that buffers PCM
 * frames during recording and computes SHA-256 in a single pass at finalize.
 * SubtleCrypto does NOT expose a true streaming digest in browsers, so the
 * win here is timing: frames are accumulated WHILE recording (no work after
 * stop) and the actual digest call runs in parallel with upload prep.
 *
 * Output is bit-identical to a single-pass `crypto.subtle.digest('SHA-256', ...)`
 * over the same concatenated bytes.
 */

export class StreamingHasher {
    private accumulated: Float32Array[] = [];
    private totalSamples = 0;

    feed(frame: Float32Array): void {
        // Copy so we don't hold a reference to a transferred ArrayBuffer.
        const owned = new Float32Array(frame);
        this.accumulated.push(owned);
        this.totalSamples += owned.length;
    }

    async finalize(): Promise<string> {
        const buffer = new Float32Array(this.totalSamples);
        let offset = 0;
        for (const f of this.accumulated) {
            buffer.set(f, offset);
            offset += f.length;
        }

        const digest = await crypto.subtle.digest(
            'SHA-256',
            buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        );
        const bytes = new Uint8Array(digest);
        let hex = '';
        for (let i = 0; i < bytes.length; i++) {
            hex += bytes[i].toString(16).padStart(2, '0');
        }
        return hex;
    }
}
