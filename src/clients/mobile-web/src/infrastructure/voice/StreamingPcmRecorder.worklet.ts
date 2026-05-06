/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VOICE_LATENCY_PIPELINE_V2 Phase 2 — AudioWorkletProcessor that emits
 * mono PCM frames every 128 samples. Runs in the worklet (separate JS
 * thread) and posts each frame to the main thread via MessagePort.
 *
 * This file is loaded as a module via `audioContext.audioWorklet.addModule()`.
 * The `registerProcessor` call at the bottom registers the processor with
 * the worklet runtime.
 */

declare const registerProcessor: (
    name: string,
    processorCtor: new () => AudioWorkletProcessorBase,
) => void;

interface AudioWorkletProcessorBase {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare const AudioWorkletProcessor: {
    prototype: AudioWorkletProcessorBase;
    new (): AudioWorkletProcessorBase;
};

class StreamingPcmProcessor extends AudioWorkletProcessor {
    process(inputs: Float32Array[][]): boolean {
        const input = inputs[0];
        if (!input || input.length === 0) {
            // No input connected yet — keep processor alive
            return true;
        }

        const channelCount = input.length;
        const samplesPerChannel = input[0].length;

        if (samplesPerChannel === 0) {
            return true;
        }

        // Mix down to mono: average across channels.
        // Allocate fresh buffer per frame so the transfer-list ownership
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

        // Transfer the underlying ArrayBuffer to the main thread (zero-copy).
        this.port.postMessage(mono, [mono.buffer]);

        // Returning true keeps the processor running until the AudioWorkletNode
        // is disconnected from the graph.
        return true;
    }
}

registerProcessor('streaming-pcm-processor', StreamingPcmProcessor);
