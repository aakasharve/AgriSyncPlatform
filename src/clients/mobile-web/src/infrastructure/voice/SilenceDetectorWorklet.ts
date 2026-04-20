import { SilenceConfig } from './types';

export interface SilenceDetectorSummary {
    speechFrames: number;
    silenceFrames: number;
    totalFrames: number;
    speechRatio: number;
    silenceRatio: number;
    lastRms: number;
    lastUpdatedAtMs: number;
}

export interface SilenceDetectorHandle {
    readonly supported: boolean;
    getSummary: () => SilenceDetectorSummary;
    dispose: () => void;
}

const WORKLET_PROCESSOR_NAME = 'agrisync-silence-detector';

export function classifyAudioFrame(
    samples: Float32Array,
    rmsThreshold: number,
): {
    rms: number;
    isSpeech: boolean;
} {
    if (samples.length === 0) {
        return { rms: 0, isSpeech: false };
    }

    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        sum += sample * sample;
    }

    const rms = Math.sqrt(sum / samples.length);
    return {
        rms,
        isSpeech: rms >= rmsThreshold,
    };
}

function createWorkletSource(): string {
    return `
class AgriSyncSilenceDetectorProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const opts = options && options.processorOptions ? options.processorOptions : {};
        this.rmsThreshold = typeof opts.rmsThreshold === 'number' ? opts.rmsThreshold : 0.01;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) {
            return true;
        }

        const channel = input[0];
        if (!channel || channel.length === 0) {
            return true;
        }

        let sum = 0;
        for (let i = 0; i < channel.length; i++) {
            const sample = channel[i];
            sum += sample * sample;
        }

        const rms = Math.sqrt(sum / channel.length);
        this.port.postMessage({
            type: 'frame',
            rms,
            isSpeech: rms >= this.rmsThreshold,
            frameSize: channel.length
        });

        return true;
    }
}

registerProcessor('${WORKLET_PROCESSOR_NAME}', AgriSyncSilenceDetectorProcessor);
`;
}

function resolveAudioContextCtor(): typeof AudioContext | null {
    if (typeof AudioContext !== 'undefined') {
        return AudioContext;
    }

    const maybeWindow = typeof window !== 'undefined' ? (window as { webkitAudioContext?: typeof AudioContext }) : undefined;
    if (maybeWindow?.webkitAudioContext) {
        return maybeWindow.webkitAudioContext;
    }

    return null;
}

function getEmptySummary(): SilenceDetectorSummary {
    return {
        speechFrames: 0,
        silenceFrames: 0,
        totalFrames: 0,
        speechRatio: 0,
        silenceRatio: 0,
        lastRms: 0,
        lastUpdatedAtMs: Date.now(),
    };
}

export async function createSilenceDetector(
    stream: MediaStream,
    config: SilenceConfig,
): Promise<SilenceDetectorHandle | null> {
    if (typeof window === 'undefined') {
        return null;
    }

    if (typeof AudioWorkletNode === 'undefined') {
        return null;
    }

    const AudioContextCtor = resolveAudioContextCtor();
    if (!AudioContextCtor) {
        return null;
    }

    const audioContext = new AudioContextCtor();
    if (!audioContext.audioWorklet) {
        await audioContext.close().catch(() => {});
        return null;
    }

    const summary = getEmptySummary();
    const source = audioContext.createMediaStreamSource(stream);
    const sink = audioContext.createGain();
    sink.gain.value = 0;

    let detectorNode: AudioWorkletNode | null = null;
    let moduleUrl: string | null = null;
    let disposed = false;

    try {
        moduleUrl = URL.createObjectURL(
            new Blob([createWorkletSource()], { type: 'application/javascript' }),
        );
        await audioContext.audioWorklet.addModule(moduleUrl);

        detectorNode = new AudioWorkletNode(audioContext, WORKLET_PROCESSOR_NAME, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: {
                rmsThreshold: config.rmsThreshold,
            },
        });

        detectorNode.port.onmessage = (event: MessageEvent) => {
            const payload = event.data as { type?: string; isSpeech?: boolean; rms?: number } | undefined;
            if (payload?.type !== 'frame' || typeof payload.isSpeech !== 'boolean') {
                return;
            }

            summary.totalFrames += 1;
            if (payload.isSpeech) {
                summary.speechFrames += 1;
            } else {
                summary.silenceFrames += 1;
            }

            if (typeof payload.rms === 'number') {
                summary.lastRms = payload.rms;
            }

            summary.lastUpdatedAtMs = Date.now();
        };

        source.connect(detectorNode);
        detectorNode.connect(sink);
        sink.connect(audioContext.destination);
        await audioContext.resume().catch(() => {});
    } catch {
        detectorNode?.disconnect();
        source.disconnect();
        sink.disconnect();
        if (moduleUrl) {
            URL.revokeObjectURL(moduleUrl);
        }
        await audioContext.close().catch(() => {});
        return null;
    }

    const dispose = () => {
        if (disposed) {
            return;
        }
        disposed = true;

        detectorNode?.disconnect();
        source.disconnect();
        sink.disconnect();
        detectorNode?.port.close();

        if (moduleUrl) {
            URL.revokeObjectURL(moduleUrl);
        }

        void audioContext.close().catch(() => {});
    };

    return {
        supported: true,
        getSummary: () => {
            if (summary.totalFrames > 0) {
                summary.speechRatio = summary.speechFrames / summary.totalFrames;
                summary.silenceRatio = summary.silenceFrames / summary.totalFrames;
            } else {
                summary.speechRatio = 0;
                summary.silenceRatio = 0;
            }

            return { ...summary };
        },
        dispose,
    };
}
