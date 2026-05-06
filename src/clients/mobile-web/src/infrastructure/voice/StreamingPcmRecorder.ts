/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VOICE_LATENCY_PIPELINE_V2 Phase 2 — main-thread façade for the
 * AudioWorklet PCM streaming recorder. Wires up:
 *   getUserMedia → MediaStreamAudioSourceNode → AudioWorkletNode (custom processor)
 *
 * The processor (StreamingPcmRecorder.worklet.ts) emits mono PCM frames
 * (typically 128 samples each at the AudioContext sample rate); this class
 * accumulates them and forwards each to an `onFrame` callback so callers
 * can run silence-trim + hashing during recording instead of after stop.
 */

import { StreamingPcmConfig } from './types';

export interface StreamingPcmRecording {
    pcm: Float32Array;
    sampleRate: number;
    durationMs: number;
}

type AudioContextCtor = { new(options?: AudioContextOptions): AudioContext };

export class StreamingPcmRecorder {
    private audioContext: AudioContext | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private mediaStream: MediaStream | null = null;
    private accumulatedFrames: Float32Array[] = [];
    private startTime = 0;
    private onFrame?: (frame: Float32Array) => void;

    constructor(private readonly config: StreamingPcmConfig) {
        // config.frameSize / workletBufferSize are reserved for future tuning;
        // the processor currently emits at the AudioWorklet's native frame size (128).
        void this.config;
    }

    static isSupported(): boolean {
        if (typeof window === 'undefined') return false;
        const ctor = StreamingPcmRecorder.resolveAudioContextCtor();
        return ctor !== null
            && typeof navigator !== 'undefined'
            && typeof navigator.mediaDevices !== 'undefined'
            && typeof navigator.mediaDevices.getUserMedia === 'function';
    }

    async start(onFrame?: (frame: Float32Array) => void): Promise<void> {
        if (this.audioContext) {
            throw new Error('StreamingPcmRecorder is already recording.');
        }
        this.onFrame = onFrame;
        this.accumulatedFrames = [];

        const Ctor = StreamingPcmRecorder.resolveAudioContextCtor();
        if (!Ctor) {
            throw new Error('AudioContext is not available in this environment.');
        }

        this.mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                echoCancellation: true,
                noiseSuppression: true,
            },
        });

        this.audioContext = new Ctor({ sampleRate: 16000 });

        // Worklet module path is resolved at build-time by Vite's URL constructor pattern.
        const moduleUrl = new URL('./StreamingPcmRecorder.worklet.ts', import.meta.url).href;
        await this.audioContext.audioWorklet.addModule(moduleUrl);

        this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.workletNode = new AudioWorkletNode(this.audioContext, 'streaming-pcm-processor');

        this.workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
            const frame = event.data;
            this.accumulatedFrames.push(frame);
            this.onFrame?.(frame);
        };

        this.sourceNode.connect(this.workletNode);
        // Connecting to destination is required by some browsers to keep the worklet
        // running, but we don't actually want to monitor the audio. The AudioContext's
        // destination is muted by default unless the user attaches output.
        this.workletNode.connect(this.audioContext.destination);

        this.startTime = performance.now();
    }

    async stop(): Promise<StreamingPcmRecording> {
        if (!this.audioContext) {
            throw new Error('StreamingPcmRecorder is not recording.');
        }

        const sampleRate = this.audioContext.sampleRate;
        const durationMs = performance.now() - this.startTime;

        // Best-effort tear-down. Cleanup failures must not lose the recorded buffer.
        try {
            this.sourceNode?.disconnect();
            this.workletNode?.disconnect();
            await this.audioContext.close().catch(() => {});
            this.mediaStream?.getTracks().forEach(t => t.stop());
        } catch {
            // ignore — proceed to return whatever was captured
        }

        // Flatten accumulated frames into a single Float32Array.
        const totalSamples = this.accumulatedFrames.reduce((sum, f) => sum + f.length, 0);
        const pcm = new Float32Array(totalSamples);
        let offset = 0;
        for (const frame of this.accumulatedFrames) {
            pcm.set(frame, offset);
            offset += frame.length;
        }

        this.audioContext = null;
        this.workletNode = null;
        this.sourceNode = null;
        this.mediaStream = null;
        this.accumulatedFrames = [];

        return { pcm, sampleRate, durationMs };
    }

    private static resolveAudioContextCtor(): AudioContextCtor | null {
        if (typeof AudioContext !== 'undefined') {
            return AudioContext;
        }
        const maybeWindow = typeof window !== 'undefined'
            ? (window as unknown as { webkitAudioContext?: AudioContextCtor })
            : undefined;
        return maybeWindow?.webkitAudioContext ?? null;
    }
}
