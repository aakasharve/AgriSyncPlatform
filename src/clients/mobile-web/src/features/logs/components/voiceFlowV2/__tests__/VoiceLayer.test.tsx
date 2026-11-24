// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (F2, F3) - the voice journey's full-screen layer: one fixed layer over the whole screen, the app's
 * chrome steps away while it is open, the place chip is drawn only when there is a place, the right-hand chip only when the caller
 * holds a number (never invented), and the saved screen's "आणखी सांगा" bar is the layer's BOTTOM bar, outside the scrolling body.
 */
import React, { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: 'mr' as const, setLanguage: () => undefined, t: (k: string) => t(k, 'mr') });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import IdleCloseBar from '../IdleCloseBar';
import { VoiceLayer } from '../VoiceLayer';
import { useVoiceLayerOpen } from '../voiceLayerSignal';

afterEach(cleanup);

const Chrome: React.FC = () => <span data-testid="chrome">{useVoiceLayerOpen() ? 'hidden' : 'shown'}</span>;

describe('VoiceLayer', () => {
    it('is one fixed full-screen layer in the body, and the app chrome reads it as open only while it is mounted', () => {
        const { rerender } = render(<><Chrome /><VoiceLayer step="entry"><p>mic</p></VoiceLayer></>);
        const layer = screen.getByTestId('voice-layer');
        expect(layer.parentElement).toBe(document.body);
        expect(layer.className).toContain('fixed');
        expect(layer.className).toContain('inset-0');
        expect(screen.getByTestId('chrome').textContent).toBe('hidden');
        rerender(<Chrome />);
        expect(screen.getByTestId('chrome').textContent).toBe('shown');
        expect(screen.queryByTestId('voice-layer')).toBeNull();
    });

    it('draws the place chip only with a place, and the right-hand chip only when given one (never invented)', () => {
        const { rerender } = render(<VoiceLayer step="entry"><p>x</p></VoiceLayer>);
        expect(screen.queryByTestId('voice-layer-place')).toBeNull();
        expect(screen.queryByTestId('voice-layer-chip')).toBeNull();
        rerender(<VoiceLayer step="entry" placeLabel="द्राक्ष · प्लॉट १"><p>x</p></VoiceLayer>);
        expect(screen.getByTestId('voice-layer-place').textContent).toBe('द्राक्ष · प्लॉट १');
        expect(screen.queryByTestId('voice-layer-chip')).toBeNull();
        rerender(<VoiceLayer step="entry" placeLabel={() => 'द्राक्ष · प्लॉट २'} rightChip="या महिन्यात १८ दिवस"><p>x</p></VoiceLayer>);
        expect(screen.getByTestId('voice-layer-place').textContent).toBe('द्राक्ष · प्लॉट २');
        expect(screen.getByTestId('voice-layer-chip').textContent).toBe('या महिन्यात १८ दिवस');
    });

    it('keeps the back control it is given in the top row', () => {
        render(<VoiceLayer step="saved" back={<button data-testid="b">मागे</button>} placeLabel="द्राक्ष"><p>x</p></VoiceLayer>);
        expect(screen.getByTestId('voice-layer-top').contains(screen.getByTestId('b'))).toBe(true);
    });

    it('F3: the "आणखी सांगा" bar is drawn in the layer\'s bottom slot, not inside the scrolling body', () => {
        const Saved: React.FC = () => {
            const root = useRef<HTMLDivElement>(null);
            return <div ref={root}><IdleCloseBar rootRef={root} pauseReason={null} offReason={null} onClose={() => undefined} onAddAnother={() => undefined} /></div>;
        };
        render(<VoiceLayer step="saved"><Saved /></VoiceLayer>);
        const bar = screen.getByTestId('vr2-idle-bar');
        expect(bar.getAttribute('data-placed')).toBe('bottom');
        expect(screen.getByTestId('voice-layer-bottom').contains(bar)).toBe(true);
        expect(screen.getByTestId('voice-layer-body').contains(bar)).toBe(false);
        expect(bar.className).not.toContain('sticky');
    });
});
