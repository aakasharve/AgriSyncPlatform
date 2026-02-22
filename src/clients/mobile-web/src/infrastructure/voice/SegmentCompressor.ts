/**
 * Layer 4: Segment Compressor
 *
 * Encodes PCM audio chunks to compressed Opus/WebM format.
 * Uses MediaRecorder API for hardware-accelerated encoding.
 */

import { CompressionConfig } from './types';

export class SegmentCompressor {
    private readonly config: CompressionConfig;

    constructor(config: CompressionConfig) {
        this.config = config;
    }

    /**
     * Compress PCM Float32Array to Opus/WebM Blob.
     * Uses OfflineAudioContext + MediaRecorder for encoding.
     */
    async compress(pcmData: Float32Array, inputSampleRate: number): Promise<{
        blob: Blob;
        mimeType: string;
        compressionRatio: number;
    }> {
        const rawSizeBytes = pcmData.length * 4; // Float32 = 4 bytes per sample

        // Resample if needed
        const resampled = inputSampleRate !== this.config.targetSampleRate
            ? await this.resample(pcmData, inputSampleRate, this.config.targetSampleRate)
            : pcmData;

        // Encode using MediaRecorder via AudioContext trick
        const blob = await this.encodeToWebm(resampled, this.config.targetSampleRate);
        const compressionRatio = blob.size / rawSizeBytes;

        return {
            blob,
            mimeType: this.config.mimeType,
            compressionRatio,
        };
    }

    /**
     * Check if the browser supports the target codec.
     */
    static isSupported(): boolean {
        if (typeof MediaRecorder === 'undefined') return false;
        return MediaRecorder.isTypeSupported('audio/webm;codecs=opus');
    }

    /**
     * Resample PCM data to target sample rate using OfflineAudioContext.
     */
    private async resample(
        pcmData: Float32Array,
        fromRate: number,
        toRate: number
    ): Promise<Float32Array> {
        const duration = pcmData.length / fromRate;
        const offlineCtx = new OfflineAudioContext(1, Math.ceil(duration * toRate), toRate);
        const buffer = offlineCtx.createBuffer(1, pcmData.length, fromRate);
        buffer.getChannelData(0).set(pcmData);

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(offlineCtx.destination);
        source.start(0);

        const rendered = await offlineCtx.startRendering();
        return rendered.getChannelData(0);
    }

    /**
     * Encode Float32Array PCM to WebM/Opus blob using MediaRecorder.
     */
    private async encodeToWebm(pcmData: Float32Array, sampleRate: number): Promise<Blob> {
        return new Promise<Blob>((resolve, reject) => {
            try {
                const audioCtx = new AudioContext({ sampleRate });
                const buffer = audioCtx.createBuffer(1, pcmData.length, sampleRate);
                buffer.getChannelData(0).set(pcmData);

                const source = audioCtx.createBufferSource();
                source.buffer = buffer;

                const dest = audioCtx.createMediaStreamDestination();
                source.connect(dest);

                const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                    ? 'audio/webm;codecs=opus'
                    : 'audio/webm';

                const recorder = new MediaRecorder(dest.stream, {
                    mimeType,
                    audioBitsPerSecond: this.config.targetBitrate,
                });

                const chunks: Blob[] = [];

                recorder.ondataavailable = (e) => {
                    if (e.data.size > 0) {
                        chunks.push(e.data);
                    }
                };

                recorder.onstop = () => {
                    audioCtx.close();
                    resolve(new Blob(chunks, { type: mimeType }));
                };

                recorder.onerror = (e) => {
                    audioCtx.close();
                    reject(new Error(`MediaRecorder error: ${e}`));
                };

                recorder.start();
                source.start(0);

                // Stop recording after audio finishes
                const durationMs = (pcmData.length / sampleRate) * 1000;
                setTimeout(() => {
                    if (recorder.state === 'recording') {
                        recorder.stop();
                    }
                    source.stop();
                }, durationMs + 100); // small buffer
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Fallback: return raw PCM as WAV blob if MediaRecorder is unavailable.
     */
    static createWavBlob(pcmData: Float32Array, sampleRate: number): Blob {
        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
        const blockAlign = numChannels * (bitsPerSample / 8);
        const dataSize = pcmData.length * (bitsPerSample / 8);
        const headerSize = 44;
        const buffer = new ArrayBuffer(headerSize + dataSize);
        const view = new DataView(buffer);

        // WAV header
        const writeString = (offset: number, str: string) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);

        // Convert Float32 to Int16
        let offset = headerSize;
        for (let i = 0; i < pcmData.length; i++) {
            const sample = Math.max(-1, Math.min(1, pcmData[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }
}
