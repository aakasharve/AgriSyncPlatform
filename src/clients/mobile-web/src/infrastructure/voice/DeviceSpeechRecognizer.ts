import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

export interface DeviceSpeechRecognizerOptions {
    language: string; // e.g. 'mr-IN'
}
export type DeviceSpeechResult = { transcript: string } | { error: 'unavailable' | 'permission-denied' | 'failed' };

/**
 * On-device Android SpeechRecognizer (Capacitor). Offline-capable ASR used by
 * the voice-continuity ladder when Sarvam/network is unreachable. No-op on web
 * (returns 'unavailable') so callers degrade to the audio-only pending capture.
 */
export class DeviceSpeechRecognizer {
    async transcribe(opts: DeviceSpeechRecognizerOptions): Promise<DeviceSpeechResult> {
        if (!Capacitor.isNativePlatform()) {
            return { error: 'unavailable' };
        }
        try {
            const { available } = await SpeechRecognition.available();
            if (!available) {
                return { error: 'unavailable' };
            }
            const perm = await SpeechRecognition.requestPermissions();
            if (perm.speechRecognition !== 'granted') {
                return { error: 'permission-denied' };
            }
            const result = await SpeechRecognition.start({
                language: opts.language,
                maxResults: 2,
                partialResults: false,
                popup: false,
            });
            const matches = (result as { matches?: string[] }).matches ?? [];
            const transcript = (matches[0] ?? '').trim();
            if (!transcript) {
                return { error: 'failed' };
            }
            return { transcript };
        } catch {
            return { error: 'failed' };
        }
    }
}
