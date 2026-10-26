// spec: plr-d10-redesign-real-integration-2026-10-25 (I17, H19; PLR-D9 N2-N6) — every place's मागे
// returns to where he came from (`goBackOr`), with the usual parent only as the fallback; Referrals,
// the leftover Settings page and the separate export / erase rows are no longer farmer doors.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import type { AppRouterContext } from '../routeContext';
import {
    renderAiDraftsRoute,
    renderConsentRoute,
    renderLabourRoute,
    renderOfflineConflictsRoute,
    renderProfileRoute,
    renderReferralsRoute,
    renderVoiceDiaryRoute,
} from '../simpleRoutes';
import { PageBar } from '../../../shared/components/ui/placeUi';

type Props = Record<string, unknown> & { onBack?: () => void; onExit?: () => void; title?: string };

function ctxWith(currentRoute: string) {
    const setCurrentRoute = vi.fn();
    const goBackOr = vi.fn();
    const ctx = { currentRoute, setCurrentRoute, goBackOr, history: [], farmerProfile: {}, crops: [] } as unknown as AppRouterContext;
    return { ctx, setCurrentRoute, goBackOr };
}

/** The single screen inside a route's animation wrapper. */
const onlyChild = (node: React.ReactNode) => (node as React.ReactElement<{ children: React.ReactElement<Props> }>).props.children;

describe('one back model: each place goes back where he came from', () => {
    it('हजेरी (labour) returns where he came from — the hub only as the fallback (it was fixed to the hub)', () => {
        const { ctx, setCurrentRoute, goBackOr } = ctxWith('labour');
        const page = onlyChild(renderLabourRoute(ctx));
        page.props.onExit!();
        expect(goBackOr).toHaveBeenCalledWith('profile');
        expect(setCurrentRoute).not.toHaveBeenCalled();
    });

    it.each([
        ['voiceDiary', renderVoiceDiaryRoute, 'profile'],
        ['consent', renderConsentRoute, 'profile'],
        ['ai-drafts', renderAiDraftsRoute, 'profile'],
        ['offline-conflicts', renderOfflineConflictsRoute, 'main'],
    ] as const)('%s: मागे goes back, with %s… as the fallback', (route, render, fallback) => {
        const { ctx, setCurrentRoute, goBackOr } = ctxWith(route);
        const page = onlyChild(render(ctx));
        page.props.onBack!();
        expect(goBackOr).toHaveBeenCalledWith(fallback);
        expect(setCurrentRoute).not.toHaveBeenCalled();
    });

    it('the recordings page no longer sends him to the leftover Settings page', () => {
        const { ctx } = ctxWith('voiceDiary');
        const page = onlyChild(renderVoiceDiaryRoute(ctx));
        expect(page.props).not.toHaveProperty('onOpenSettings');
    });

    it('a deep link to Referrals is no dead end: one title bar with मागे', () => {
        const { ctx, goBackOr } = ctxWith('referrals');
        const node = renderReferralsRoute(ctx) as React.ReactElement<{ children: React.ReactElement<Props>[] }>;
        const [bar] = React.Children.toArray(node.props.children) as React.ReactElement<Props>[];
        expect(bar.type).toBe(PageBar);
        expect(bar.props.title).toBe('रेफरल्स');
        bar.props.onBack!();
        expect(goBackOr).toHaveBeenCalledWith('profile');
    });

    it('the hub is handed no Referrals door and no separate export / erase doors', () => {
        const { ctx, setCurrentRoute } = ctxWith('profile');
        const hub = onlyChild(renderProfileRoute(ctx));
        expect(hub.props).not.toHaveProperty('onOpenReferrals');
        expect(hub.props).not.toHaveProperty('onOpenExport');
        expect(hub.props).not.toHaveProperty('onOpenErasure');
        (hub.props.onOpenConsent as () => void)();
        expect(setCurrentRoute).toHaveBeenCalledWith('consent');
    });
});
