/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, PLR-D5) — the LIVE loudness of the
 * microphone while the farmer speaks, for the recorder's level meter.
 *
 * It only LISTENS to the stream the recorder already opened: a second AudioContext with an
 * AnalyserNode that is connected to nothing else, so it cannot change what is recorded, how it
 * is encoded or what is uploaded. No stream (idle), or a phone without Web Audio, gives
 * `undefined` — and the meter is then not drawn at all rather than faked (doctrine P4/P5).
 */
import { useEffect, useState } from 'react';

type AudioContextCtor = new () => AudioContext;

/** How often the level is read. Matches the meter's own frame (~11 per second). */
export const MIC_LEVEL_POLL_MS = 90;
/** Speech RMS rarely passes ~0.3 of full scale; this lifts a normal voice to most of the meter. */
const GAIN = 3.2;

function resolveAudioContext(): AudioContextCtor | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** RMS of 8-bit time-domain samples (128 = silence), scaled to 0..1. */
export function levelFromSamples(samples: Uint8Array): number {
    if (samples.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) {
        const v = (samples[i] - 128) / 128;
        sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / samples.length) * GAIN);
}

/**
 * The live input level (0..1) of `stream`, or `undefined` when there is no stream or the
 * phone cannot measure it.
 */
export function useMicLevel(stream: MediaStream | null): number | undefined {
    const [reading, setReading] = useState<{ stream: MediaStream; level: number } | null>(null);

    useEffect(() => {
        if (!stream) return undefined;
        const Ctor = resolveAudioContext();
        if (!Ctor) return undefined;

        let ctx: AudioContext;
        try {
            ctx = new Ctor();
        } catch {
            return undefined;
        }
        let source: MediaStreamAudioSourceNode;
        let analyser: AnalyserNode;
        try {
            source = ctx.createMediaStreamSource(stream);
            analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);
        } catch {
            void ctx.close?.().catch?.(() => undefined);
            return undefined;
        }

        const samples = new Uint8Array(analyser.fftSize);
        const id = window.setInterval(() => {
            analyser.getByteTimeDomainData(samples);
            setReading({ stream, level: levelFromSamples(samples) });
        }, MIC_LEVEL_POLL_MS);

        return () => {
            window.clearInterval(id);
            try { source.disconnect(); } catch { /* already gone */ }
            void ctx.close?.().catch?.(() => undefined);
        };
    }, [stream]);

    // A reading belongs to the stream it was taken from: a stale one never outlives its recording.
    return stream && reading?.stream === stream ? reading.level : undefined;
}
