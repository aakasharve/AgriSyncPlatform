/**
 * Layer 4: Segment Compressor
 *
 * Encodes PCM audio chunks into compressed Opus/WebM when supported.
 */

import { CompressionConfig } from './types';

type AudioContextCtor = { new(options?: AudioContextOptions): AudioContext };

export class SegmentCompressor {
    private readonly config: CompressionConfig;

    constructor(config: CompressionConfig) {
        this.config = config;
    }

    async compress(
        pcmData: Float32Array,
        inputSampleRate: number,
    ): Promise<{
        blob: Blob;
        mimeType: string;
        compressionRatio: number;
    }> {
        const rawSizeBytes = Math.max(1, pcmData.length * 4);
        if (pcmData.length === 0) {
            throw new Error('Cannot compress empty PCM data.');
        }

        const resampled = inputSampleRate !== this.config.targetSampleRate
            ? await this.resample(pcmData, inputSampleRate, this.config.targetSampleRate)
            : pcmData;
        const blob = await this.encodeToWebm(resampled, this.config.targetSampleRate);

        return {
            blob,
            mimeType: blob.type || this.config.mimeType,
            compressionRatio: blob.size / rawSizeBytes,
        };
    }

    static getSupportedMimeType(): string | null {
        if (typeof MediaRecorder === 'undefined') {
            return null;
        }

        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            return 'audio/webm;codecs=opus';
        }

        if (MediaRecorder.isTypeSupported('audio/webm')) {
            return 'audio/webm';
        }

        return null;
    }

    static isSupported(): boolean {
        return SegmentCompressor.getSupportedMimeType() !== null;
    }

    private async resample(
        pcmData: Float32Array,
        fromRate: number,
        toRate: number,
    ): Promise<Float32Array> {
        const duration = pcmData.length / fromRate;
        const offlineContext = new OfflineAudioContext(1, Math.ceil(duration * toRate), toRate);
        const buffer = offlineContext.createBuffer(1, pcmData.length, fromRate);
        buffer.getChannelData(0).set(pcmData);

        const source = offlineContext.createBufferSource();
        source.buffer = buffer;
        source.connect(offlineContext.destination);
        source.start(0);

        const rendered = await offlineContext.startRendering();
        return new Float32Array(rendered.getChannelData(0));
    }

    private async encodeToWebm(pcmData: Float32Array, sampleRate: number): Promise<Blob> {
        const mimeType = SegmentCompressor.getSupportedMimeType();
        if (!mimeType) {
            throw new Error('MediaRecorder Opus/WebM support is unavailable.');
        }

        const AudioContextConstructor = SegmentCompressor.resolveAudioContextCtor();
        if (!AudioContextConstructor) {
            throw new Error('AudioContext is unavailable for encoding.');
        }

        return new Promise<Blob>((resolve, reject) => {
            const audioContext = new AudioContextConstructor({ sampleRate });
            const timeoutMs = Math.max(1500, Math.ceil((pcmData.length / sampleRate) * 1000) + 1500);
            let settled = false;
            let timeoutHandle: number | null = null;

            const complete = (callback: () => void) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timeoutHandle !== null) {
                    clearTimeout(timeoutHandle);
                }
                callback();
            };

            try {
                const buffer = audioContext.createBuffer(1, pcmData.length, sampleRate);
                buffer.getChannelData(0).set(pcmData);

                const source = audioContext.createBufferSource();
                source.buffer = buffer;

                const destination = audioContext.createMediaStreamDestination();
                source.connect(destination);

                const recorder = new MediaRecorder(destination.stream, {
                    mimeType,
                    audioBitsPerSecond: this.config.targetBitrate,
                });
                const chunks: Blob[] = [];

                recorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        chunks.push(event.data);
                    }
                };

                recorder.onerror = () => {
                    complete(() => {
                        void audioContext.close().catch(() => {});
                        reject(new Error('MediaRecorder failed while encoding segment.'));
                    });
                };

                recorder.onstop = () => {
                    const blob = new Blob(chunks, { type: mimeType });
                    complete(() => {
                        void audioContext.close().catch(() => {});
                        if (blob.size <= 0) {
                            reject(new Error('MediaRecorder produced an empty encoded blob.'));
                            return;
                        }
                        resolve(blob);
                    });
                };

                source.onended = () => {
                    if (recorder.state === 'recording') {
                        recorder.stop();
                    }
                };

                recorder.start();
                source.start(0);

                timeoutHandle = window.setTimeout(() => {
                    if (recorder.state === 'recording') {
                        recorder.stop();
                    }
                }, timeoutMs);
            } catch (error) {
                complete(() => {
                    void audioContext.close().catch(() => {});
                    reject(error instanceof Error ? error : new Error('Failed to initialize segment encoding.'));
                });
            }
        });
    }

    static createWavBlob(pcmData: Float32Array, sampleRate: number): Blob {
        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
        const blockAlign = numChannels * (bitsPerSample / 8);
        const dataSize = pcmData.length * (bitsPerSample / 8);
        const headerSize = 44;
        const buffer = new ArrayBuffer(headerSize + dataSize);
        const view = new DataView(buffer);

        const writeString = (offset: number, text: string): void => {
            for (let i = 0; i < text.length; i++) {
                view.setUint8(offset + i, text.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);

        let offset = headerSize;
        for (let i = 0; i < pcmData.length; i++) {
            const sample = Math.max(-1, Math.min(1, pcmData[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }

        return new Blob([buffer], { type: 'audio/wav' });
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
