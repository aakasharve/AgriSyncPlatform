import { classifyAudioFrame } from '../src/infrastructure/voice/SilenceDetectorWorklet';
import { SilenceTrimmer } from '../src/infrastructure/voice/SilenceTrimmer';
import { IntentChunker } from '../src/infrastructure/voice/IntentChunker';
import { SegmentCompressor } from '../src/infrastructure/voice/SegmentCompressor';
import { VoicePreprocessor } from '../src/infrastructure/voice/VoicePreprocessor';
import { DEFAULT_VOICE_CONFIG } from '../src/infrastructure/voice/types';

type TestResult = {
    name: string;
    passed: boolean;
    detail: string;
};

function concatSegments(segments: Float32Array[]): Float32Array {
    const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;

    for (const segment of segments) {
        result.set(segment, offset);
        offset += segment.length;
    }

    return result;
}

function buildConstantPcm(seconds: number, sampleRate: number, amplitude: number): Float32Array {
    const samples = Math.max(1, Math.floor(seconds * sampleRate));
    const data = new Float32Array(samples);
    data.fill(amplitude);
    return data;
}

function installCompressionMocks(): void {
    const globalAny = globalThis as unknown as {
        window?: typeof globalThis;
        AudioContext?: any;
        MediaRecorder?: any;
    };

    globalAny.window = globalThis;

    class MockAudioContext {
        public destination = {};

        createBuffer(_channels: number, length: number, _sampleRate: number): AudioBuffer {
            const channelData = new Float32Array(length);
            return {
                getChannelData: () => channelData,
            } as unknown as AudioBuffer;
        }

        createBufferSource(): AudioBufferSourceNode {
            const source = {
                buffer: null as AudioBuffer | null,
                onended: null as (() => void) | null,
                connect: () => {},
                start: () => {
                    setTimeout(() => {
                        source.onended?.();
                    }, 10);
                },
            };
            return source as unknown as AudioBufferSourceNode;
        }

        createMediaStreamDestination(): MediaStreamAudioDestinationNode {
            return {
                stream: {} as MediaStream,
            } as MediaStreamAudioDestinationNode;
        }

        close(): Promise<void> {
            return Promise.resolve();
        }
    }

    class MockMediaRecorder {
        static isTypeSupported(type: string): boolean {
            return type === 'audio/webm;codecs=opus' || type === 'audio/webm';
        }

        public mimeType: string;
        public state: 'inactive' | 'recording' = 'inactive';
        public ondataavailable: ((event: { data: Blob }) => void) | null = null;
        public onerror: (() => void) | null = null;
        public onstop: (() => void) | null = null;

        constructor(_stream: MediaStream, options?: { mimeType?: string }) {
            this.mimeType = options?.mimeType ?? 'audio/webm;codecs=opus';
        }

        start(): void {
            this.state = 'recording';
            setTimeout(() => {
                this.ondataavailable?.({
                    data: new Blob([new Uint8Array([0x01, 0x02, 0x03])], { type: this.mimeType }),
                });
            }, 10);
        }

        stop(): void {
            this.state = 'inactive';
            this.onstop?.();
        }
    }

    globalAny.AudioContext = MockAudioContext;
    globalAny.MediaRecorder = MockMediaRecorder;
}

async function run(): Promise<void> {
    installCompressionMocks();

    const results: TestResult[] = [];
    const sampleRate = 16_000;

    {
        const speechFrame = buildConstantPcm(0.02, sampleRate, 0.1);
        const silenceFrame = buildConstantPcm(0.02, sampleRate, 0.0001);
        const speech = classifyAudioFrame(speechFrame, DEFAULT_VOICE_CONFIG.silence.rmsThreshold);
        const silence = classifyAudioFrame(silenceFrame, DEFAULT_VOICE_CONFIG.silence.rmsThreshold);

        const passed = speech.isSpeech && !silence.isSpeech && speech.rms > silence.rms;
        results.push({
            name: 'SilenceDetectorWorklet speech/silence classification',
            passed,
            detail: `speechRms=${speech.rms.toFixed(4)}, silenceRms=${silence.rms.toFixed(6)}`,
        });
    }

    const testClip = concatSegments([
        buildConstantPcm(1.0, sampleRate, 0.2),
        buildConstantPcm(2.0, sampleRate, 0),
        buildConstantPcm(1.0, sampleRate, 0.2),
    ]);

    {
        const trimmer = new SilenceTrimmer(DEFAULT_VOICE_CONFIG.silence);
        const trimmed = trimmer.trimSilence(testClip, sampleRate);
        const removedRatio = trimmed.totalSilenceRemovedMs / ((testClip.length / sampleRate) * 1000);
        const passed = removedRatio >= 0.30;
        results.push({
            name: 'SilenceTrimmer removes >=30% duration',
            passed,
            detail: `removedRatio=${(removedRatio * 100).toFixed(2)}%`,
        });
    }

    {
        const chunker = new IntentChunker(DEFAULT_VOICE_CONFIG.chunking, DEFAULT_VOICE_CONFIG.silence);
        const chunks = chunker.chunkAudio(testClip, sampleRate);
        const passed = chunks.length === 2;
        results.push({
            name: 'IntentChunker segment count for known pauses',
            passed,
            detail: `segmentCount=${chunks.length}`,
        });
    }

    {
        const compressor = new SegmentCompressor(DEFAULT_VOICE_CONFIG.compression);
        const compressed = await compressor.compress(buildConstantPcm(1, sampleRate, 0.2), sampleRate);
        const passed = compressed.blob.size > 0 && compressed.mimeType.toLowerCase().includes('webm');
        results.push({
            name: 'SegmentCompressor outputs valid Opus/WebM blob',
            passed,
            detail: `size=${compressed.blob.size}, mime=${compressed.mimeType}`,
        });
    }

    {
        const preprocessor = new VoicePreprocessor(DEFAULT_VOICE_CONFIG);
        const output = await preprocessor.processAsSingleBlob(
            testClip,
            sampleRate,
            'session-regression-smoke',
            'farm-regression-smoke',
        );

        const passed = output.audioBlob.size > 0
            && output.metadata.totalSegments === 1
            && output.metadata.totalRawDurationMs >= output.metadata.totalSpeechDurationMs
            && output.contentHash.length === 64;

        results.push({
            name: 'Voice recording flow regression smoke (preprocess path)',
            passed,
            detail: `blob=${output.audioBlob.size}, speechMs=${output.metadata.totalSpeechDurationMs.toFixed(0)}, rawMs=${output.metadata.totalRawDurationMs.toFixed(0)}`,
        });
    }

    const failed = results.filter(result => !result.passed);
    for (const result of results) {
        const marker = result.passed ? 'PASS' : 'FAIL';
        console.log(`[${marker}] ${result.name} -> ${result.detail}`);
    }

    if (failed.length > 0) {
        throw new Error(`Voice pipeline gate failed: ${failed.map(result => result.name).join('; ')}`);
    }
}

void run();
