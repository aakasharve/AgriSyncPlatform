// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (MU design §6). The team screens over ONE read model
 * (`/me/context`): the role band, the farm switcher's rows (Marathi only; Active relationships only; the open farm marked), the
 * relationship cards (active / invited / waiting / paused), the nameboard's small word, and the totals line for a chosen-plots
 * seat. Marathi mode shows only Marathi and English mode only English. Only the network and the language are stubbed.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ lang: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: h.lang, setLanguage: () => undefined, t: (k: string) => k }),
    useLanguage: () => ({ language: h.lang, setLanguage: () => undefined, t: (k: string) => k }),
}));
vi.mock('../../invitations/personalInvitationClient', async (actual) => ({
    ...(await actual<typeof import('../../invitations/personalInvitationClient')>()),
    acceptInvitation: vi.fn(),
    declineInvitation: vi.fn(),
}));

import { FarmContext } from '../../../core/session/FarmContext';
import type { MeContext, MeFarm } from '../../../core/session/MeContextService';
import { FarmSwitcherSheet } from '../../context/components/FarmContextSwitcher';
import FarmNameBoard from '../../context/components/FarmNameBoard';
import { MyResponsibilities } from '../MyResponsibilities';
import { PlotsOnlyNote } from '../PlotsOnlyNote';
import RoleBand from '../RoleBand';
import { boardRelationWord, ownsNoFarm, switcherRows } from '../relationshipModel';

const NOW = new Date();
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const DEVANAGARI = /[ऀ-ॿ]/;

const farm = (over: Partial<MeFarm> & { farmId: string }): MeFarm => ({
    name: 'पाटील फार्म', farmCode: 'K7M2QP', ownerAccountId: 'acc', role: 'Worker', status: 'Active', joinedVia: 'QrScan',
    plan: 'Free', planValidUntilUtc: null,
    capabilities: { canInvite: false, canVerify: false, canAddCost: true, canSeeBilling: false },
    permissions: [], authorities: [], plotScope: 'OwnWork', plotNames: [],
    ...over,
});

const ctx = (farms: MeFarm[], over: Partial<MeContext> = {}): MeContext => ({
    me: { userId: 'u', displayName: 'रामराव', phoneMasked: '******1234', phoneVerifiedAtUtc: null, preferredLanguage: 'mr', authMode: 'Otp' },
    farms,
    share: { referralCode: null, referralsTotal: 0, referralsQualified: 0, benefitsEarned: 0 },
    alerts: [], serverTimeUtc: NOW.toISOString(), ...over,
});

const withContext = (meContext: MeContext, currentFarmId: string, ui: React.ReactElement) => {
    const farms = meContext.farms.filter(f => !f.status || f.status === 'Active');
    const value = {
        meContext, isLoading: false, currentFarmId,
        currentFarm: farms.find(f => f.farmId === currentFarmId) ?? farms[0] ?? null,
        farms, switchFarm: vi.fn(), refresh: vi.fn(async () => undefined), loadFailed: false,
    };
    return <FarmContext.Provider value={value}>{ui}</FarmContext.Provider>;
};

const OWNER_FARM = farm({ farmId: 'a', name: 'Arve Farm', role: 'PrimaryOwner', plotScope: 'AllPlots' });
const MUKADAM_FARM = farm({
    farmId: 'b', name: 'Patil Farm', role: 'Mukadam', label: 'Mukadam', plotScope: 'ChosenPlots', plotNames: ['प्लॉट 2', 'प्लॉट 4'],
    authorities: [{ name: 'TakeAttendance', expiresAtUtc: inDays(3) }, { name: 'ConfirmRecords', expiresAtUtc: null }],
});

beforeEach(() => { h.lang = 'mr'; });
afterEach(cleanup);

describe('the farm switcher sheet', () => {
    const open = (meContext: MeContext, currentFarmId: string, lang?: 'mr' | 'en') => {
        if (lang) h.lang = lang;
        return render(withContext(meContext, currentFarmId, (
            <FarmSwitcherSheet farms={[]} currentFarmId={currentFarmId} onClose={vi.fn()} onSwitch={vi.fn()} onCreateFarm={vi.fn()} onJoinViaQr={vi.fn()}
                rows={switcherRows(meContext, currentFarmId, h.lang)} ownsNoFarm={ownsNoFarm(meContext)} language={h.lang} />
        )));
    };

    it('is Marathi only in Marathi mode: today\'s "Your farms · N" and "Create farm / Join via QR" English are gone', () => {
        open(ctx([OWNER_FARM, MUKADAM_FARM]), 'a');
        const sheet = screen.getByTestId('farm-switcher-sheet');
        expect(within(sheet).getByTestId('farm-switcher-title')).toHaveTextContent('तुमच्या शेती');
        const text = sheet.textContent ?? '';
        expect(text).not.toMatch(/Your farms|Create farm|Join via QR/);
        expect(text.replace(/QR/g, '').replace(/Arve Farm|Patil Farm/g, '')).not.toMatch(/[A-Za-z]/);
    });

    it('one row per Active relationship: name, word, scope summary, expiry only when near, the open one marked "सध्या उघडलेली"', () => {
        open(ctx([OWNER_FARM, MUKADAM_FARM]), 'b');
        const rowA = screen.getByTestId('farm-switcher-row-a');
        const rowB = screen.getByTestId('farm-switcher-row-b');
        expect(within(rowA).getByTestId('farm-switcher-row-name')).toHaveTextContent('Arve Farm');
        expect(within(rowA).getByTestId('farm-switcher-row-word')).toHaveTextContent('मालक');
        expect(within(rowA).getByTestId('farm-switcher-row-plots')).toHaveTextContent('सर्व प्लॉट');
        expect(within(rowA).queryByTestId('farm-switcher-row-until')).toBeNull();
        expect(within(rowA).queryByTestId('farm-switcher-row-current')).toBeNull();
        expect(within(rowB).getByTestId('farm-switcher-row-word')).toHaveTextContent('मुकादम');
        expect(within(rowB).getByTestId('farm-switcher-row-plots')).toHaveTextContent('2 प्लॉट');
        expect(within(rowB).getByTestId('farm-switcher-row-until')).toHaveTextContent(/पर्यंत$/);
        expect(within(rowB).getByTestId('farm-switcher-row-current')).toHaveTextContent('सध्या उघडलेली');
        expect(within(rowB).getByTestId('farm-switcher-row-check')).toBeInTheDocument();
    });

    it('the whole card is the button: a tap on the row switches', () => {
        const onSwitch = vi.fn();
        const meContext = ctx([OWNER_FARM, MUKADAM_FARM]);
        render(withContext(meContext, 'a', (
            <FarmSwitcherSheet farms={[]} currentFarmId="a" onClose={vi.fn()} onSwitch={onSwitch} onCreateFarm={vi.fn()} onJoinViaQr={vi.fn()}
                rows={switcherRows(meContext, 'a', 'mr')} language="mr" />
        )));
        fireEvent.click(screen.getByTestId('farm-switcher-row-b'));
        expect(onSwitch).toHaveBeenCalledWith('b');
    });

    it('never lists a waiting invitation, a waiting request or a paused seat as a row', () => {
        const meContext = ctx(
            [OWNER_FARM, farm({ farmId: 'w', name: 'Waiting Farm', status: 'PendingApproval' }), farm({ farmId: 'p', name: 'Paused Farm', status: 'Suspended' })],
            { invitations: [{ invitationId: 'i1', farmName: 'Invited Farm', invitedByName: 'मालक', label: 'Worker', name: null, plotScope: 'OwnWork', plotNames: [], authorities: [], expiresAtUtc: inDays(5), namesAWorker: false }] },
        );
        open(meContext, 'a');
        expect(screen.getByTestId('farm-switcher-row-a')).toBeInTheDocument();
        expect(screen.queryByTestId('farm-switcher-row-w')).toBeNull();
        expect(screen.queryByTestId('farm-switcher-row-p')).toBeNull();
        expect(screen.getByTestId('farm-switcher-sheet').textContent).not.toMatch(/Waiting Farm|Paused Farm|Invited Farm/);
    });

    it('a worker (no farm of his own) is asked "तुमचं स्वतःचं शेत आहे का?"; an owner is not', () => {
        const workerOnly = ctx([farm({ farmId: 'b', name: 'Patil Farm', role: 'Worker' })]);
        open(workerOnly, 'b');
        expect(screen.getByTestId('farm-switcher-own-farm')).toHaveTextContent('तुमचं स्वतःचं शेत आहे का?');
        cleanup();
        open(ctx([OWNER_FARM, MUKADAM_FARM]), 'a');
        expect(screen.queryByTestId('farm-switcher-own-farm')).toBeNull();
    });

    it('English mode has the English twins and no Marathi', () => {
        open(ctx([OWNER_FARM, MUKADAM_FARM]), 'b', 'en');
        const text = screen.getByTestId('farm-switcher-sheet').textContent ?? '';
        expect(text).toContain('Your farms');
        expect(text).toContain('Open now');
        expect(text).toContain('Mukadam');
        expect(text).not.toMatch(DEVANAGARI);
    });
});

describe('the role band and the nameboard word', () => {
    it('draws the band and the plots line for a मुकादम on chosen plots', () => {
        const meContext = ctx([MUKADAM_FARM]);
        render(<RoleBand meContext={meContext} currentFarmId="b" language="mr" />);
        expect(screen.getByTestId('role-band-line')).toHaveTextContent('तुम्ही: रामराव · मुकादम');
        expect(screen.getByTestId('role-band-plots')).toHaveTextContent('2 प्लॉट');
    });

    it('draws nothing for a single-farm primary owner (his screens stay as today)', () => {
        const { container } = render(<RoleBand meContext={ctx([OWNER_FARM])} currentFarmId="a" language="mr" />);
        expect(container).toBeEmptyDOMElement();
    });

    it('the nameboard keeps the farm name primary and shows the relationship word under it only when given', () => {
        const meContext = ctx([OWNER_FARM, MUKADAM_FARM]);
        render(<FarmNameBoard farmName="Patil Farm" onOpenFarmSwitcher={vi.fn()} canSwitch relationWord={boardRelationWord(meContext, 'b', 'mr')} />);
        expect(screen.getByTestId('farm-nameboard-name')).toHaveTextContent('Patil Farm');
        expect(screen.getByTestId('farm-nameboard-subtitle')).toHaveTextContent('मुकादम');
        cleanup();
        render(<FarmNameBoard farmName="Arve Farm" onOpenFarmSwitcher={vi.fn()} />);
        expect(screen.getByTestId('farm-nameboard-subtitle')).toHaveTextContent('Managed by Shram Safal');
    });
});

describe('माझी शेती व जबाबदाऱ्या', () => {
    it('is not drawn for a single-farm primary owner with nothing waiting', () => {
        render(withContext(ctx([OWNER_FARM]), 'a', <MyResponsibilities />));
        expect(screen.queryByTestId('my-responsibilities')).toBeNull();
    });

    it('draws one card per relationship in each state, with the open one marked', () => {
        const meContext = ctx(
            [
                OWNER_FARM,
                MUKADAM_FARM,
                farm({ farmId: 'w', name: 'Shinde Mala', status: 'PendingApproval' }),
                farm({ farmId: 'p', name: 'Jadhav Wadi', status: 'Suspended', role: 'Worker', statusReason: 'हंगाम संपला' }),
            ],
            { invitations: [{ invitationId: 'i1', farmName: 'Kale Shet', invitedByName: 'काळे', label: 'Worker', name: null, plotScope: 'OwnWork', plotNames: [], authorities: [], expiresAtUtc: inDays(5), namesAWorker: false }] },
        );
        render(withContext(meContext, 'b', <MyResponsibilities />));
        expect(screen.getByTestId('my-responsibilities')).toHaveTextContent('माझी शेती व जबाबदाऱ्या');

        // active - owner: all responsibilities
        const owner = screen.getByTestId('relationship-card-a');
        expect(within(owner).getByTestId('relationship-word')).toHaveTextContent('मालक');
        expect(within(owner).getByTestId('relationship-owner-all')).toBeInTheDocument();
        expect(within(owner).queryByTestId('relationship-opened')).toBeNull();

        // active - मुकादम on chosen plots: plot names, plain-word authorities, a near expiry, and the open pill
        const mukadam = screen.getByTestId('relationship-card-b');
        expect(within(mukadam).getByTestId('relationship-word')).toHaveTextContent('मुकादम');
        expect(within(mukadam).getByTestId('relationship-plots')).toHaveTextContent('प्लॉट 2, प्लॉट 4');
        expect(within(mukadam).getByTestId('relationship-authorities').textContent).toMatch(/हजेरी/);
        expect(within(mukadam).getByTestId('relationship-authorities').textContent).toMatch(/पर्यंत/);
        expect(within(mukadam).getByTestId('relationship-until')).toBeInTheDocument();
        expect(within(mukadam).getByTestId('relationship-opened')).toHaveTextContent('सध्या उघडलेली');

        // waiting for the owner
        const waiting = screen.getByTestId('relationship-card-w');
        expect(within(waiting).getByTestId('relationship-waiting')).toHaveTextContent('मालकाच्या मंजुरीची वाट');

        // paused with its reason
        const paused = screen.getByTestId('relationship-card-p');
        expect(within(paused).getByTestId('relationship-paused')).toHaveTextContent('काम थांबवलं — कारण: हंगाम संपला');

        // invited: MU-2's card with स्वीकारा / नको
        expect(screen.getByText('स्वीकारा')).toBeInTheDocument();
        expect(screen.getByText('नको')).toBeInTheDocument();
    });

    it('English mode is English only', () => {
        h.lang = 'en';
        const meContext = ctx([OWNER_FARM, MUKADAM_FARM, farm({ farmId: 'p', name: 'Jadhav Wadi', status: 'Suspended', statusReason: 'season over' })]);
        render(withContext(meContext, 'b', <MyResponsibilities />));
        const text = (screen.getByTestId('my-responsibilities').textContent ?? '').replace(/Arve Farm|Patil Farm|Jadhav Wadi|season over|प्लॉट \d/g, '');
        expect(text).toContain('My farms and responsibilities');
        expect(text).toContain('Work paused');
        expect(text).not.toMatch(DEVANAGARI);
    });

    it('reads /me/context only: with no context it draws nothing', () => {
        const { container } = render(<MyResponsibilities />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('the totals line for a chosen-plots seat (R3-L2)', () => {
    it('says "तुमच्या प्लॉटचे" for a seat on chosen plots, and nothing for the owner or a seat on every plot', () => {
        render(withContext(ctx([MUKADAM_FARM]), 'b', <PlotsOnlyNote />));
        expect(screen.getByTestId('totals-plots-only')).toHaveTextContent('तुमच्या प्लॉटचे');
        cleanup();
        render(withContext(ctx([OWNER_FARM]), 'a', <PlotsOnlyNote />));
        expect(screen.queryByTestId('totals-plots-only')).toBeNull();
        cleanup();
        render(withContext(ctx([farm({ farmId: 'c', role: 'SecondaryOwner', plotScope: 'AllPlots' })]), 'c', <PlotsOnlyNote />));
        expect(screen.queryByTestId('totals-plots-only')).toBeNull();
        cleanup();
        h.lang = 'en';
        render(withContext(ctx([MUKADAM_FARM]), 'b', <PlotsOnlyNote />));
        expect(screen.getByTestId('totals-plots-only')).toHaveTextContent('Your plots');
    });
});
