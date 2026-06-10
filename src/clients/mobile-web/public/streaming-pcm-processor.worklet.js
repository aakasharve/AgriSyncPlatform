/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VOICE_LATENCY_PIPELINE_V2 — AudioWorkletProcessor that emits mono PCM frames
 * every 128 samples and posts each to the main thread via MessagePort.
 *
 * Served as a STATIC asset from public/ (loaded via audioContext.audioWorklet
 * .addModule('/streaming-pcm-processor.worklet.js')). The previous source
 * reference — new URL('./StreamingPcmRecorder.worklet.ts', import.meta.url) —
 * was not emitted/compiled by Vite, so addModule() 404'd in production and the
 * streaming recorder surfaced a misleading "Could not access microphone".
 * `AudioWorkletProcessor` and `registerProcessor` are globals in the worklet scope.
 */

class StreamingPcmProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) {
            // No input connected yet — keep the processor alive.
            return true;
        }

        const channelCount = input.length;
        const samplesPerChannel = input[0].length;

        if (samplesPerChannel === 0) {
            return true;
        }

        // Mix down to mono. Allocate a fresh buffer per frame so the transfer-list
        // hands a unique ArrayBuffer to the main thread each time.
        const mono = new Float32Array(samplesPerChannel);
        if (channelCount === 1) {
            mono.set(input[0]);
        } else {
            for (let s = 0; s < samplesPerChannel; s++) {
                let acc = 0;
                for (let c = 0; c < channelCount; c++) {
                    acc += input[c][s];
                }
                mono[s] = acc / channelCount;
            }
        }

        // Zero-copy transfer of the underlying ArrayBuffer to the main thread.
        this.port.postMessage(mono, [mono.buffer]);

        // Returning true keeps the processor running until the node is disconnected.
        return true;
    }
}

registerProcessor('streaming-pcm-processor', StreamingPcmProcessor);
