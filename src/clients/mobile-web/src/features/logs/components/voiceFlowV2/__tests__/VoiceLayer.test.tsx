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
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: 'mr' as const, setLanguage: () => undefined, t: (k: string) => t(k, 'mr') });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { getDateKey } from '../../../../../core/domain/services/DateKeyService';
import type { DailyLog } from '../../../../../types';
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
            return <div ref={root}><IdleCloseBar rootRef={root} waitMs={5000} pauseReason={null} offReason={null} onClose={() => undefined} onAddAnother={() => undefined} /></div>;
        };
        render(<VoiceLayer step="saved"><Saved /></VoiceLayer>);
        const bar = screen.getByTestId('vr2-idle-bar');
        expect(bar.getAttribute('data-placed')).toBe('bottom');
        expect(screen.getByTestId('voice-layer-bottom').contains(bar)).toBe(true);
        expect(screen.getByTestId('voice-layer-body').contains(bar)).toBe(false);
        expect(bar.className).not.toContain('sticky');
    });
});

describe('month chip (F2)', () => {
    const today = getDateKey();
    const history = [{ id: 'a', date: today, context: { selection: [{ selectedPlotIds: ['p1'] }] } }] as unknown as DailyLog[];
    it('is NOT drawn before the phone has completed a pull (coverage cannot be shown), and is drawn after', async () => {
        await resetDatabase();
        render(<VoiceLayer step="saved" monthOf={{ history, plotId: 'p1' }} placeLabel="द्राक्ष"><p>x</p></VoiceLayer>);
        await new Promise(r => setTimeout(r, 50));
        expect(screen.queryByTestId('voice-layer-chip')).toBeNull();
        cleanup();
        await getDatabase().syncCursors.put({ tableName: 'shramsafal', lastSyncAt: new Date().toISOString(), version: 1 });
        render(<VoiceLayer step="saved" monthOf={{ history, plotId: 'p1' }} placeLabel="द्राक्ष"><p>x</p></VoiceLayer>);
        await waitFor(() => expect(screen.getByTestId('voice-layer-chip').textContent).toBe('या महिन्यात १ दिवस'));
    });
    it('no single plot = no chip', async () => {
        await getDatabase().syncCursors.put({ tableName: 'shramsafal', lastSyncAt: new Date().toISOString(), version: 1 });
        render(<VoiceLayer step="saved" monthOf={{ history, plotId: null }}><p>x</p></VoiceLayer>);
        await new Promise(r => setTimeout(r, 50));
        expect(screen.queryByTestId('voice-layer-chip')).toBeNull();
    });
});
