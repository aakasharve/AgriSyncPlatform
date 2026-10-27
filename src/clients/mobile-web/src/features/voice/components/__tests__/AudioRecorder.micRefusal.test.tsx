// @vitest-environment jsdom
// spec: dfes-companion-2026-07-11 (wave-4.3)
//
// REFUSING THE MICROPHONE MUST NOT BLOCK MANUAL ENTRY.
//
// An OS permission is not DPDP consent, and refusing one is not withdrawing the other. It
// is also not a reason to close the app to a farmer: he can type. The typing route has
// always been mounted here, but until wave-4.3 the failure message was a bare
// "microphone error", and a farmer reading only that reasonably concludes the app is now
// useless to him. A route that exists but is not visible is not a route.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../shared/utils/haptics', () => ({ hapticFeedback: () => undefined }));

import AudioRecorder from '../AudioRecorder';
// plr-d10 I12 — the mic's accessible name is now the founder's own Marathi sentence (was "Start Recording").
import { MIC_INSTRUCTION, REC_WORDS } from '../recorder/recorderWords';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const denyMicrophone = () => {
    const err = new Error('Permission denied');
    err.name = 'NotAllowedError';
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: vi.fn().mockRejectedValue(err) },
    });
};

describe('AudioRecorder when the microphone is refused', () => {
    it('keeps the typing route open and points the farmer at it', async () => {
        denyMicrophone();
        const onTextCaptured = vi.fn();
        render(<AudioRecorder onAudioCaptured={vi.fn()} onTextCaptured={onTextCaptured} />);

        // Trying to record is what triggers the OS prompt — just-in-time, at the moment
        // the feature is invoked, not in a sweep at onboarding.
        fireEvent.click(screen.getByRole('button', { name: MIC_INSTRUCTION }));

        await waitFor(() =>
            expect(screen.getByText(REC_WORDS.micDenied)).toBeInTheDocument());

        // The typing way in is still there and still usable. plr-d10 I12: it is the quiet
        // "type instead" line under the mic (was an always-open text box), and after a refusal it
        // is drawn at full strength, because it is now THE way in.
        const link = screen.getByTestId('typed-link');
        expect(link).toBeEnabled();
        expect(link.className).toContain('opacity-100');
        fireEvent.click(link);

        const input = screen.getByTestId('typed-input');
        fireEvent.change(input, { target: { value: 'आज फवारणी केली' } });
        fireEvent.click(screen.getByTestId('typed-send'));
        expect(onTextCaptured).toHaveBeenCalledWith('आज फवारणी केली');
    });

    it('does not present a refusal as the generic microphone error', async () => {
        denyMicrophone();
        render(<AudioRecorder onAudioCaptured={vi.fn()} onTextCaptured={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: MIC_INSTRUCTION }));

        await waitFor(() =>
            expect(screen.getByText(REC_WORDS.micDenied)).toBeInTheDocument());
        expect(screen.queryByText(REC_WORDS.micError)).not.toBeInTheDocument();
    });
});
