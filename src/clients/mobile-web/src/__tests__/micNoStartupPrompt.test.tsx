// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves — the RECORD_AUDIO prompt used to appear on
// every cold start (MainActivity.onCreate requested it before the farmer touched
// the mic). The permission is now asked at the first mic tap, by the WebView's
// own getUserMedia flow. These tests pin "nothing asks at startup".

import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ recorderStart: vi.fn() }));

vi.mock('../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../shared/utils/haptics', () => ({ hapticFeedback: () => undefined }));
vi.mock('../infrastructure/voice/StreamingPcmRecorder', () => ({
    StreamingPcmRecorder: class {
        start = (...a: unknown[]) => h.recorderStart(...a);
        stop = vi.fn().mockResolvedValue({ pcm: new Float32Array(0), sampleRate: 16000, durationMs: 0 });
    },
}));

import AudioRecorder from '../features/voice/components/AudioRecorder';
import AudioRecorderStreaming from '../features/voice/components/AudioRecorderStreaming';

afterEach(() => {
    cleanup();
    h.recorderStart.mockReset();
});

const installMedia = () => {
    const getUserMedia = vi.fn();
    const query = vi.fn().mockResolvedValue({ state: 'prompt' });
    Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.defineProperty(globalThis.navigator, 'permissions', { configurable: true, value: { query } });
    return { getUserMedia, query };
};

describe('no microphone permission request at app start', () => {
    it('MainActivity no longer requests RECORD_AUDIO in onCreate', () => {
        const java = fs.readFileSync(
            path.resolve(__dirname, '../../android/app/src/main/java/com/agrisync/shramsafal/MainActivity.java'),
            'utf8',
        );
        expect(java).not.toMatch(/requestPermissions\s*\(/);
        expect(java).not.toMatch(/ensureAudioPermission/);
    });

    it('mounting either recorder (boot of the log screen) never calls getUserMedia', () => {
        const { getUserMedia } = installMedia();
        render(<AudioRecorder onAudioCaptured={vi.fn()} />);
        render(<AudioRecorderStreaming onAudioCaptured={vi.fn()} />);
        expect(getUserMedia).not.toHaveBeenCalled();
        expect(h.recorderStart).not.toHaveBeenCalled();
    });

    it('the streaming recorder asks only when the mic is tapped, and a refusal shows the type-instead message (not the generic error)', async () => {
        installMedia();
        const denied = new Error('denied');
        denied.name = 'NotAllowedError';
        h.recorderStart.mockRejectedValue(denied);

        render(<AudioRecorderStreaming onAudioCaptured={vi.fn()} />);
        expect(h.recorderStart).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Start Recording' }));
        await waitFor(() => expect(screen.getByText('voice.micDeniedTypeInstead')).toBeInTheDocument());
        expect(screen.queryByText(/voice\.micError/)).not.toBeInTheDocument();

        // retry by tapping again: the OS is asked again and a grant now records
        h.recorderStart.mockResolvedValue(undefined);
        fireEvent.click(screen.getByRole('button', { name: 'Start Recording' }));
        await waitFor(() => expect(h.recorderStart).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByText('voice.micDeniedTypeInstead')).not.toBeInTheDocument());
    });
});
