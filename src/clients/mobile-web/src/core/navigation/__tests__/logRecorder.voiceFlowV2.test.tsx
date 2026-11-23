// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 6) — THE waiting screen (`renderProcessingScreen`, shared by the log tab and every
 * speak entry point): with `voiceFlowV2` on it is the calm step list; with it off it is exactly today's screen (the श्रम
 * साथी screen under `dailyLoop`, else the legacy spinner).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const flags = vi.hoisted(() => ({ dailyLoop: true, voiceFlowV2: false as boolean | undefined }));
vi.mock('../../../app/featureFlags', async orig => {
    const real = await orig<typeof import('../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k in flags ? flags[k as keyof typeof flags] : t[k as keyof typeof t]) }) };
});
vi.mock('../../../features/logs/components/shramsathi/ShramSathiUnderstanding', () => ({
    ShramSathiUnderstanding: () => <div data-testid="shram-sathi-understanding" />,
}));
vi.mock('../../../i18n/LanguageContext', () => {
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k });
    return { useOptionalLanguage: ctx, useLanguage: ctx };
});

import { renderProcessingScreen } from '../logRecorder';
import type { AppRouterContext } from '../routeContext';

const ctx = {
    liveCaption: '', voiceStreamingPhase: 'idle',
    crops: [], farmerProfile: { operators: [], activeOperatorId: 'me' },
    logScope: { selectedCropIds: ['FARM_GLOBAL'], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
} as unknown as AppRouterContext;

afterEach(() => { cleanup(); flags.dailyLoop = true; flags.voiceFlowV2 = false; });

describe('renderProcessingScreen — voice flow v2', () => {
    it('flag on: the calm step list, not the श्रम साथी screen', () => {
        flags.voiceFlowV2 = true;
        render(<>{renderProcessingScreen(ctx)}</>);
        expect(screen.getByTestId('voice-journey')).toBeInTheDocument();
        expect(screen.queryByTestId('shram-sathi-understanding')).toBeNull();
        expect(screen.getByTestId('vj-step-kept')).toHaveAttribute('data-state', 'active');
    });

    it('flag on wins over dailyLoop off too (the legacy spinner is not drawn)', () => {
        flags.voiceFlowV2 = true;
        flags.dailyLoop = false;
        const { container } = render(<>{renderProcessingScreen(ctx)}</>);
        expect(screen.getByTestId('voice-journey')).toBeInTheDocument();
        expect(container.querySelector('.animate-spin')).toBeNull();
    });

    it.each([false, undefined])('flag off (%s) + dailyLoop: exactly today\'s श्रम साथी screen', off => {
        flags.voiceFlowV2 = off;
        const { container } = render(<>{renderProcessingScreen(ctx)}</>);
        expect(container.innerHTML).toBe('<div data-testid="shram-sathi-understanding"></div>');
    });

    it('flag off, dailyLoop off: the legacy spinner, as today', () => {
        flags.dailyLoop = false;
        const { container } = render(<>{renderProcessingScreen(ctx)}</>);
        expect(container.querySelector('.animate-spin')).not.toBeNull();
        expect(container).toHaveTextContent('श्रम साथी तुम्ही जे बोललात ते समजून घेत आहे');
        expect(screen.queryByTestId('voice-journey')).toBeNull();
    });
});
