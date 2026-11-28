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

import { renderLogRecorder, renderProcessingScreen } from '../logRecorder';
import type { AppRouterContext } from '../routeContext';
import type { RecorderFlowV2 } from '../../../features/voice/components/recorder/flowV2Types';

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

/** spec plr-d10 (part 03, A4): the log tab's own flow gets the ring screen; everything else keeps its screen. */
describe('renderProcessingScreen — the ring screen after stop (A4)', () => {
    it('flag on + the log tab\'s own flow: the ring screen, not the step list and not the श्रम साथी video screen', () => {
        flags.voiceFlowV2 = true;
        render(<>{renderProcessingScreen(ctx, { ring: true })}</>);
        expect(screen.getByTestId('ring-wait')).toBeInTheDocument();
        expect(screen.getByTestId('ring-wait-line')).toHaveTextContent('श्रम साथी समजून घेत आहे');
        expect(screen.queryByTestId('voice-journey')).toBeNull();
        expect(screen.queryByTestId('shram-sathi-understanding')).toBeNull();
    });

    it('flag on without the ring (the हजेरी door, the ONE mic\'s own screen): the step list, as before', () => {
        flags.voiceFlowV2 = true;
        render(<>{renderProcessingScreen(ctx)}</>);
        expect(screen.getByTestId('voice-journey')).toBeInTheDocument();
        expect(screen.queryByTestId('ring-wait')).toBeNull();
    });

    it('flag off: the old waiting screen is still used, even when the ring is asked for', () => {
        flags.voiceFlowV2 = false;
        const { container } = render(<>{renderProcessingScreen(ctx, { ring: true })}</>);
        expect(container.innerHTML).toBe('<div data-testid="shram-sathi-understanding"></div>');
    });
});

/** spec plr-d10 (part 03, A3): the final recording screen is asked for only by the log tab's own flow (where the mic card is). */
describe('renderLogRecorder — the final recording screen (A3)', () => {
    const flowOf = (node: React.ReactNode): RecorderFlowV2 | undefined => {
        const all: React.ReactElement[] = [];
        const walk = (n: React.ReactNode) => {
            if (Array.isArray(n)) { n.forEach(walk); return; }
            if (!React.isValidElement(n)) return;
            all.push(n);
            walk((n.props as { children?: React.ReactNode }).children);
        };
        walk(node);
        const recorder = all.find(el => (el.props as { onAudioCaptured?: unknown }).onAudioCaptured !== undefined);
        return (recorder?.props as { flowV2?: RecorderFlowV2 } | undefined)?.flowV2;
    };
    const recCtx = { ...ctx, handleAudioReady: vi.fn(), handleTextReady: vi.fn(), setStatus: vi.fn(), isContextReady: true, error: null } as unknown as AppRouterContext;

    it('the log tab\'s flow (an armSeq): `listening` with the card', () => {
        flags.voiceFlowV2 = true;
        const v2 = flowOf(renderLogRecorder(recCtx, { armSeq: 2 }));
        expect(v2?.listening).toBe(true);
        expect(v2?.card?.armSeq).toBe(2);
    });

    it('the ONE mic and the हजेरी door (no armSeq): no `listening`, the earlier screen', () => {
        flags.voiceFlowV2 = true;
        const v2 = flowOf(renderLogRecorder(recCtx, {}));
        expect(v2?.silenceHelp).toBe(true);
        expect(v2?.listening).toBeUndefined();
    });

    it('flag off: no flowV2 at all', () => {
        flags.voiceFlowV2 = false;
        expect(flowOf(renderLogRecorder(recCtx, { armSeq: 2 }))).toBeUndefined();
    });
});
