/**
 * APK 1.0.14 founder report (spec: 2026-08-25-prod-cutover-waves): on the
 * labour door's confirm card the round "+" QuickLog button floated over the
 * left part of बरोबर and took its taps (measured in a browser at 360x800: 4 of
 * 15 points on the button hit the "+" instead).
 *
 * The labour door is the हजेरी door: QuickLog writes the OTHER buckets, which
 * that door must not (founder ruling 2026-08-31), so the button is not drawn
 * there at all. The ordinary log door keeps it exactly as before.
 *
 * Plain-node traversal of `renderGlobalSheets` output, the
 * labourResultOwnership.test.tsx idiom: no mount, no lazy sheet resolution.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { renderGlobalSheets } from '../globalSheets';
import type { AppRouterContext } from '../routeContext';

function findByTestId(node: React.ReactNode, testId: string): React.ReactElement | null {
    if (Array.isArray(node)) {
        for (const child of node) { const hit = findByTestId(child, testId); if (hit) return hit; }
        return null;
    }
    if (!React.isValidElement(node)) return null;
    const props = node.props as { children?: React.ReactNode; 'data-testid'?: string };
    if (props['data-testid'] === testId) return node;
    return props.children ? findByTestId(props.children, testId) : null;
}

function ctx(partial: Record<string, unknown>): AppRouterContext {
    return {
        currentRoute: 'main', mainView: 'log', status: 'idle', mode: 'manual', recordingSegment: null,
        hasActiveLogContext: true, logIntent: null,
        showTaskCreationSheet: false, setShowTaskCreationSheet: vi.fn(), handleSaveTask: vi.fn(),
        crops: [], farmerProfile: { operators: [], activeOperatorId: 'owner' },
        showReviewInbox: false, setShowReviewInbox: vi.fn(), history: [],
        showQuickLog: false, setShowQuickLog: vi.fn(),
        setMode: vi.fn(), setStatus: vi.fn(), setRecordingSegment: vi.fn(), setCurrentRoute: vi.fn(),
        showNoWorkReason: false, setShowNoWorkReason: vi.fn(), handleManualSubmit: vi.fn(), todayDateKey: '2026-10-17',
        ...partial,
    } as unknown as AppRouterContext;
}

describe('QuickLog "+" button and the labour (हजेरी) door', () => {
    it('is NOT drawn on the labour door, where it covered बरोबर', () => {
        expect(findByTestId(renderGlobalSheets(ctx({ logIntent: 'labour' })), 'add-log-fab')).toBeNull();
    });

    it('is still drawn on the ordinary log door (unchanged)', () => {
        expect(findByTestId(renderGlobalSheets(ctx({ logIntent: null })), 'add-log-fab')).not.toBeNull();
        expect(findByTestId(renderGlobalSheets(ctx({ logIntent: null, mode: 'voice' })), 'add-log-fab')).not.toBeNull();
    });
});
