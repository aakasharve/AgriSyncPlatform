// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LanguageProvider } from '../../../../../i18n/LanguageContext';
import VoiceSavedReassurance from '../VoiceSavedReassurance';

// LanguageProvider mounts LanguageSyncFromServer, which reads useFarmContext.
// This test only needs the real translation lookups from LanguageProvider (so
// the reassurance-copy regex assertion below is meaningful) — not a real farm
// session — so useFarmContext is stubbed per the established pattern used by
// src/pages/__tests__/ProfilePage.snapshot.test.tsx.
vi.mock('../../../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ meContext: null }),
}));

// vitest.config.ts does not set `test.globals`, so @testing-library/react's
// auto-cleanup-on-afterEach never registers; explicit cleanup matches the
// sibling ShramSathiMeter.test.tsx pattern in this same directory.
afterEach(() => {
    cleanup();
});

function renderWith(level: 'transcript-only' | 'audio-only') {
    return render(
        <LanguageProvider>
            <VoiceSavedReassurance level={level} />
        </LanguageProvider>,
    );
}

describe('VoiceSavedReassurance', () => {
    it('renders the transcript-only reassurance copy', () => {
        renderWith('transcript-only');
        expect(screen.getByTestId('voice-saved-reassurance')).toBeInTheDocument();
        // reassurance line is level-independent
        expect(screen.getByTestId('voice-saved-reassure')).toHaveTextContent(/counted|मोजला/);
    });
    it('renders the audio-only body variant', () => {
        renderWith('audio-only');
        expect(screen.getByTestId('voice-saved-body')).toBeInTheDocument();
    });
});
