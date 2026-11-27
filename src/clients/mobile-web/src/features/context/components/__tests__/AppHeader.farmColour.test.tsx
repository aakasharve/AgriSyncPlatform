// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 - repair R3, lane S1: the approved V3-D farm switcher (founder, 27 Nov 2026).
 *  - the nameboard shows ONLY the farm name: no role word, no subtitle; the full-width role strip under the header is gone;
 *  - under the three big buttons, a card in the open farm's colour: a 6 px strip, "तुम्ही इथे", "‹भूमिका› · ‹प्लॉट›", and with two or
 *    more farms a pill "‹N› शेती ▾" that opens the existing switcher sheet (one farm: no pill);
 *  - a 4 px strip in the farm's colour along the header's bottom edge;
 *  - after a switch, "आता: ‹शेत›" in the new farm's colour for about 1.8 s;
 *  - English mode: "You are here", "‹N› farms", "Now: ‹farm›".
 * Farm colours (`farmColour.ts`): farm-1 slate, farm-2 brown, farm-3 indigo; farm-9 also hashes to slate, so beside farm-1 it moves
 * on to green. jsdom writes inline colours as rgb().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { t as translate, type Language } from '../../../../i18n/translations';
import type { SyncQueueStatus } from '../../../sync/hooks/useSyncQueueStatus';

const h = vi.hoisted(() => ({ lang: 'mr' as 'mr' | 'en' }));
const queue: SyncQueueStatus = {
    pendingCount: 0, failedCount: 0, stuckMutations: [], syncedCount: 0, pendingUploads: 0, failedUploads: 0,
    pendingAiJobs: 0, isOnline: true, lastSyncAt: null, hasLoaded: true,
};

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: h.lang as Language, setLanguage: () => { }, t: (key: string) => translate(key, h.lang) }),
    useOptionalLanguage: () => ({ language: h.lang as Language, setLanguage: () => { }, t: (key: string) => translate(key, h.lang) }),
}));
vi.mock('../../../../shared/components/ui/PageToggle', () => ({ default: () => <div data-testid="page-toggle" /> }));
vi.mock('../../../sync', () => ({
    useSyncQueueStatus: () => queue,
    useUnqueueableLogCount: () => 0,
    SyncStatusDrawer: () => null,
}));

import AppHeader from '../AppHeader';
import { FarmContext } from '../../../../core/session/FarmContext';
import type { MeContext, MeFarm } from '../../../../core/session/MeContextService';
import type { MyFarmDto } from '../../../onboarding/qr/inviteApi';

const SLATE = { ink: 'rgb(71, 85, 105)', tint: 'rgb(241, 245, 249)' };
const BROWN = { ink: 'rgb(180, 83, 9)', tint: 'rgb(255, 247, 237)' };
const GREEN = { ink: 'rgb(4, 120, 87)', tint: 'rgb(236, 253, 245)' };
const DEVANAGARI = /[ऀ-ॿ]/;

const dto = (farmId: string, name: string, role = 'PrimaryOwner'): MyFarmDto => ({ farmId, name, role, farmCode: null, subscription: null });
const ARVE = dto('farm-1', 'Arve Farm');
const BHOSALE = dto('farm-2', 'Bhosale Vasti', 'Mukadam');
const KADAM = dto('farm-3', 'Kadam Mala', 'Worker');

const seat = (over: Partial<MeFarm> & { farmId: string }): MeFarm => ({
    name: 'Farm', farmCode: 'K7M2QP', ownerAccountId: 'acc', role: 'PrimaryOwner', status: 'Active', joinedVia: 'QrScan',
    plan: 'Free', planValidUntilUtc: null,
    capabilities: { canInvite: false, canVerify: false, canAddCost: true, canSeeBilling: false },
    permissions: [], authorities: [], plotScope: 'AllPlots', plotNames: [],
    ...over,
});
const SEATS: Record<string, MeFarm> = {
    'farm-1': seat({ farmId: 'farm-1', name: 'Arve Farm', role: 'PrimaryOwner', plotScope: 'AllPlots' }),
    'farm-2': seat({ farmId: 'farm-2', name: 'Bhosale Vasti', role: 'Mukadam', label: 'Mukadam', plotScope: 'ChosenPlots', plotNames: ['प्लॉट 1', 'प्लॉट 3'] }),
    'farm-3': seat({ farmId: 'farm-3', name: 'Kadam Mala', role: 'Worker', plotScope: 'OwnWork' }),
};
const meOf = (farmIds: string[]): MeContext => ({
    me: { userId: 'u', displayName: 'रामराव', phoneMasked: '******1234', phoneVerifiedAtUtc: null, preferredLanguage: 'mr', authMode: 'Otp' },
    farms: farmIds.map(id => SEATS[id] ?? seat({ farmId: id, name: id })),
    share: { referralCode: null, referralsTotal: 0, referralsQualified: 0, benefitsEarned: 0 },
    alerts: [], serverTimeUtc: new Date().toISOString(),
});

/** The header as the app draws it: the farm list from /farms/mine, the open farm, and /me/context through FarmContext. */
function Harness({ farms, start, withContext = true, onSwitch, route = 'main', navCardsOnlyOnMain = false }: {
    farms: MyFarmDto[]; start: string; withContext?: boolean; onSwitch?: (id: string) => void;
    route?: React.ComponentProps<typeof AppHeader>['currentRoute']; navCardsOnlyOnMain?: boolean;
}) {
    const [current, setCurrent] = React.useState(start);
    const header = (
        <AppHeader
            currentRoute={route}
            currentView="log"
            navCardsOnlyOnMain={navCardsOnlyOnMain}
            onNavigate={vi.fn()}
            onViewChange={vi.fn()}
            farmContext={{
                farms,
                currentFarmId: current,
                onSwitchFarm: (id) => { onSwitch?.(id); setCurrent(id); },
                onCreateFarm: vi.fn(),
                onJoinViaQr: vi.fn(),
            }}
        />
    );
    if (!withContext) return header;
    const meContext = meOf(farms.map(f => f.farmId));
    const value = {
        meContext, isLoading: false, currentFarmId: current,
        currentFarm: meContext.farms.find(f => f.farmId === current) ?? null,
        farms: meContext.farms, switchFarm: vi.fn(), refresh: vi.fn(async () => undefined), loadFailed: false,
    };
    return <FarmContext.Provider value={value}>{header}</FarmContext.Provider>;
}

const draw = async (props: React.ComponentProps<typeof Harness>) => {
    await act(async () => { render(<Harness {...props} />); });
};

beforeEach(() => { h.lang = 'mr'; });
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

describe('V3-D: the nameboard shows only the farm name, and the role strip is gone', () => {
    it('a मुकादम on a second farm: no role word and no subtitle on the board; no "तुम्ही: ‹नाव›" strip', async () => {
        await draw({ farms: [ARVE, BHOSALE], start: 'farm-2' });
        const board = screen.getByTestId('farm-nameboard');
        expect(within(board).getByTestId('farm-nameboard-name')).toHaveTextContent('Bhosale Vasti');
        expect(within(board).queryByTestId('farm-nameboard-subtitle')).toBeNull();
        expect(board.textContent).toBe('Bhosale Vasti');
        expect(screen.queryByTestId('role-band')).toBeNull();
        expect(screen.queryByText(/तुम्ही:/)).toBeNull();
        expect(screen.queryByText(/Managed by/)).toBeNull();
    });
});

describe('V3-D: the colour card under the three big buttons', () => {
    it('one farm (an owner): the card in the farm\'s colour, "तुम्ही इथे" and "मालक · सर्व प्लॉट", and no pill', async () => {
        await draw({ farms: [ARVE], start: 'farm-1' });
        const card = screen.getByTestId('farm-here-card');
        expect(card).toHaveAttribute('data-farm-colour', 'slate');
        expect(card.style.background).toBe(SLATE.tint);
        expect(within(card).getByTestId('farm-here-bar').style.background).toBe(SLATE.ink);
        const label = within(card).getByTestId('farm-here-label');
        expect(label).toHaveTextContent('तुम्ही इथे');
        expect(label.style.color).toBe(SLATE.ink);
        expect(within(card).getByTestId('farm-here-line')).toHaveTextContent('मालक · सर्व प्लॉट');
        expect(within(card).queryByTestId('farm-here-switch')).toBeNull();
        expect(within(card).queryByRole('button')).toBeNull();
    });

    it('sits under the three big buttons, inside the header', async () => {
        await draw({ farms: [ARVE, BHOSALE], start: 'farm-1' });
        const nav = screen.getByTestId('oversight-nav-cards');
        const card = screen.getByTestId('farm-here-card');
        expect(nav.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(card.closest('header')).not.toBeNull();
    });

    it('the plots line per seat: "मुकादम · 2 प्लॉट", "कामगार · स्वतःचं काम"', async () => {
        await draw({ farms: [ARVE, BHOSALE, KADAM], start: 'farm-2' });
        expect(screen.getByTestId('farm-here-line')).toHaveTextContent('मुकादम · 2 प्लॉट');
        cleanup();
        await draw({ farms: [ARVE, BHOSALE, KADAM], start: 'farm-3' });
        expect(screen.getByTestId('farm-here-line')).toHaveTextContent('कामगार · स्वतःचं काम');
    });

    it('three farms: a pill "३ शेती" in the farm\'s colour that opens the existing switcher sheet', async () => {
        await draw({ farms: [ARVE, BHOSALE, KADAM], start: 'farm-2' });
        const pill = screen.getByTestId('farm-here-switch');
        expect(pill.tagName).toBe('BUTTON');
        expect(pill).toHaveTextContent('३ शेती');
        expect(pill.textContent).not.toMatch(/[0-9]/);
        expect(pill.style.background).toBe(BROWN.ink);
        expect(pill.style.color).toBe('rgb(255, 255, 255)');
        expect(screen.queryByTestId('farm-switcher-sheet')).toBeNull();
        fireEvent.click(pill);
        expect(screen.getByTestId('farm-switcher-sheet')).toBeInTheDocument();
        // the open farm first, marked "सध्या इथे" in its own colour
        const rows = screen.getAllByTestId(/^farm-switcher-row-farm-\d$/);
        expect(rows[0]).toHaveAttribute('data-testid', 'farm-switcher-row-farm-2');
        expect(within(rows[0]!).getByTestId('farm-switcher-row-current')).toHaveTextContent('सध्या इथे');
        expect(within(rows[0]!).getByTestId('farm-switcher-row-current').style.background).toBe(BROWN.ink);
    });

    it('two farms: "२ शेती"', async () => {
        await draw({ farms: [ARVE, BHOSALE], start: 'farm-1' });
        expect(screen.getByTestId('farm-here-switch')).toHaveTextContent('२ शेती');
    });

    it('a 4 px strip in the farm\'s colour runs along the header\'s bottom edge', async () => {
        await draw({ farms: [ARVE, BHOSALE], start: 'farm-1' });
        const edge = screen.getByTestId('farm-colour-edge');
        expect(edge.closest('header')).not.toBeNull();
        expect(edge.style.background).toBe(SLATE.ink);
        expect(edge.className).toContain('h-1');
        expect(edge.className).toContain('bottom-0');
        expect(edge).toHaveAttribute('aria-hidden', 'true');
    });

    it('two of his farms on one colour: the later id moves on (farm-9 beside farm-1 is green, not slate)', async () => {
        await draw({ farms: [ARVE, dto('farm-9', 'Nava Mala')], start: 'farm-9' });
        expect(screen.getByTestId('farm-here-card')).toHaveAttribute('data-farm-colour', 'green');
        expect(screen.getByTestId('farm-colour-edge').style.background).toBe(GREEN.ink);
        expect(screen.getByTestId('farm-here-switch').style.background).toBe(GREEN.ink);
    });

    it('before /me/context answers: the role word from the farm list only, never a plots line it cannot know', async () => {
        await draw({ farms: [ARVE, KADAM], start: 'farm-3', withContext: false });
        expect(screen.getByTestId('farm-here-line').textContent).toBe('कामगार');
    });

    it('on a place without the three buttons (खरेदी) the card still says where he is, under the header row', async () => {
        await draw({ farms: [ARVE, BHOSALE], start: 'farm-1', route: 'procurement', navCardsOnlyOnMain: true });
        expect(screen.queryByTestId('oversight-nav-cards')).toBeNull();
        expect(screen.getByTestId('farm-here-card')).toBeInTheDocument();
    });

    it('Marathi words in the Devanagari font', async () => {
        await draw({ farms: [ARVE, BHOSALE], start: 'farm-1' });
        for (const id of ['farm-here-label', 'farm-here-line', 'farm-here-switch']) {
            expect(screen.getByTestId(id).style.fontFamily).toContain('Noto Sans Devanagari');
        }
    });
});

describe('V3-D: after a switch', () => {
    it('"आता: ‹शेत›" in the new farm\'s colour for about 1.8 s; the card and the edge take the new colour', async () => {
        vi.useFakeTimers();
        const onSwitch = vi.fn();
        await draw({ farms: [ARVE, BHOSALE, KADAM], start: 'farm-1', onSwitch });
        fireEvent.click(screen.getByTestId('farm-here-switch'));
        fireEvent.click(screen.getByTestId('farm-switcher-row-farm-2'));
        expect(onSwitch).toHaveBeenCalledWith('farm-2');
        expect(screen.queryByTestId('farm-switcher-sheet')).toBeNull();

        const note = screen.getByTestId('farm-switch-note');
        expect(note).toHaveTextContent('आता: Bhosale Vasti');
        expect(note).toHaveAttribute('role', 'status');
        expect(note.style.background).toBe(BROWN.ink);
        expect(note.style.color).toBe('rgb(255, 255, 255)');
        // drawn outside the header: a fixed note inside the blurred sticky header would be trapped in it
        expect(note.closest('header')).toBeNull();
        expect(screen.getByTestId('farm-here-card')).toHaveAttribute('data-farm-colour', 'brown');
        expect(screen.getByTestId('farm-colour-edge').style.background).toBe(BROWN.ink);

        await act(async () => { vi.advanceTimersByTime(1700); });
        expect(screen.getByTestId('farm-switch-note')).toBeInTheDocument();
        await act(async () => { vi.advanceTimersByTime(200); });
        expect(screen.queryByTestId('farm-switch-note')).toBeNull();
    });

    it('a tap on the farm already open is not a switch: no note', async () => {
        await draw({ farms: [ARVE, BHOSALE], start: 'farm-1' });
        fireEvent.click(screen.getByTestId('farm-here-switch'));
        fireEvent.click(screen.getByTestId('farm-switcher-row-farm-1'));
        expect(screen.queryByTestId('farm-switch-note')).toBeNull();
    });
});

describe('V3-D: English mode', () => {
    it('"You are here", "Owner · All plots", "3 farms", "Now: ‹farm›", "Current"; no Devanagari but the names', async () => {
        h.lang = 'en';
        await draw({ farms: [ARVE, BHOSALE, KADAM], start: 'farm-1' });
        const card = screen.getByTestId('farm-here-card');
        expect(within(card).getByTestId('farm-here-label')).toHaveTextContent('You are here');
        expect(within(card).getByTestId('farm-here-line')).toHaveTextContent('Owner · All plots');
        expect(within(card).getByTestId('farm-here-switch')).toHaveTextContent('3 farms');
        expect(card.textContent).not.toMatch(DEVANAGARI);
        expect(within(card).getByTestId('farm-here-label').style.fontFamily).toContain('DM Sans');

        fireEvent.click(screen.getByTestId('farm-here-switch'));
        expect(screen.getByTestId('farm-switcher-row-current')).toHaveTextContent('Current');
        fireEvent.click(screen.getByTestId('farm-switcher-row-farm-3'));
        const note = screen.getByTestId('farm-switch-note');
        expect(note).toHaveTextContent('Now: Kadam Mala');
        expect(note.textContent).not.toMatch(DEVANAGARI);
    });
});
