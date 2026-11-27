// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S7; drawing V4-B; founder A8.1-A8.7; CTO ruling Q7 = A) - a farm's own
 * "शेताची ओळख" page:
 *   - owner and co-owner see the land shells; a मुकादम and a कामगार see only the lock line;
 *   - no "पडताळलेलं" and no tick in the land section; both upload buttons are disabled and the part says लवकरच;
 *   - one 7/12 square, the −/+ greyed;
 *   - nothing in the land section writes to storage or the network;
 *   - the boundary block speaks Marathi in Marathi mode (it said "Redraw", "Farm boundary drawn", "Weather pending", "Draw Farm Boundary");
 *   - a weather problem is said in the app's language, not the server's English;
 *   - no English "Log Out" on the page (the hub's "बाहेर पडा" is the one).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ touched: 0 }));
vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({ getDatabase: () => { db.touched += 1; throw new Error('no storage here'); } }));
vi.mock('../../../admin/billing/EntitlementBanner', () => ({ default: () => null }));
vi.mock('../../../people/components/MembershipsList', () => ({ default: () => <div data-testid="memberships" /> }));
vi.mock('../../../onboarding/components/PendingJoinRequests', () => ({ default: () => <div data-testid="pending" /> }));

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FarmIdentityPage, type FarmIdentityPageProps } from '../FarmIdentityPage';
import { LandShells } from '../LandShells';
import type { FarmDetailsDto } from '../../../onboarding/qr/inviteApi';

const details = (over: Partial<FarmDetailsDto> = {}): FarmDetailsDto => ({
    id: 'F1', name: 'आरवे फार्म', ownerUserId: 'u', ownerAccountId: 'a', canonicalCentreLat: null, canonicalCentreLng: null, centreSource: null,
    weatherRadiusKm: 5, totalMappedAreaAcres: null, totalGovtAreaAcres: null, geoValidationStatus: '', createdAtUtc: '', modifiedAtUtc: '', ...over,
});

const props = (over: Partial<FarmIdentityPageProps> = {}): FarmIdentityPageProps => ({
    language: 'mr', myFarm: { farmId: 'F1', name: 'आरवे फार्म', role: 'PrimaryOwner', subscription: null }, farmCode: 'GT4702',
    myMemberships: [], farmDetails: details(), weatherConnected: false, connectingWeather: false, connectError: null,
    handleConnectWeather: vi.fn(), setShowFarmBoundary: vi.fn(), canEditFarmSetup: true, nonExitableFarmIds: new Set(),
    handleExitMembership: vi.fn(async () => {}), ...over,
});

afterEach(() => { cleanup(); db.touched = 0; vi.restoreAllMocks(); });

describe('V4-B land shells', () => {
    it.each([['PrimaryOwner'], ['SecondaryOwner']])('%s sees the shells: one square, the stepper greyed, uploads disabled, लवकरच', role => {
        render(<LandShells role={role} language="mr" />);
        const land = screen.getByTestId('land-shells');
        expect(land).toHaveTextContent('ही रचना पुढच्या टप्प्यासाठी आहे. इथली माहिती अजून तपासली जात नाही.');
        expect(land).toHaveTextContent('या शेतात किती सातबारा उतारे एकत्र आहेत?');
        expect(land).toHaveTextContent('अनेक सातबारा उतारे मिळून एक शेत असू शकतं.');
        expect(screen.getByTestId('land-count-value')).toHaveTextContent('१');
        expect(screen.getByTestId('land-count-minus')).toBeDisabled();
        expect(screen.getByTestId('land-count-plus')).toBeDisabled();
        expect(screen.getByTestId('land-tile-1')).toHaveTextContent('७/१२');
        expect(screen.queryByTestId('land-tile-2')).toBeNull();
        expect(screen.getByTestId('land-upload')).toBeDisabled();
        expect(screen.getByTestId('land-add-co-owner')).toBeDisabled();
        expect(within(land).getAllByText('लवकरच').length).toBeGreaterThan(1);
        expect(land).toHaveTextContent('मोबाईल पडताळणी म्हणजे मालकी सिद्ध होत नाही');
        expect(land.textContent).not.toMatch(/पडताळलेल|✓/);
        expect(land.querySelector('input,textarea,select')).toBeNull();
    });

    it.each([['Mukadam'], ['Worker'], [null]])('%s sees only "ही माहिती फक्त मालक आणि सहमालक पाहू शकतात."', role => {
        render(<LandShells role={role} language="mr" />);
        expect(screen.getByTestId('land-owners-only')).toHaveTextContent('ही माहिती फक्त मालक आणि सहमालक पाहू शकतात.');
        expect(screen.queryByTestId('land-shells')).toBeNull();
    });

    it('nothing in it writes to storage or the network, even when tapped', async () => {
        const user = userEvent.setup();
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        render(<LandShells role="PrimaryOwner" language="mr" />);
        await user.click(screen.getByTestId('land-tile-1'));
        await user.click(screen.getByTestId('land-upload'));
        await user.click(screen.getByTestId('land-count-plus'));
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(db.touched).toBe(0);
        expect(screen.getByTestId('land-count-value')).toHaveTextContent('१');
    });

    it('English mode: English only', () => {
        render(<LandShells role="PrimaryOwner" language="en" />);
        expect(screen.getByTestId('land-shells').textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});

describe('the farm page', () => {
    it('its header is the farm and its code; the boundary block is Marathi; no English "Log Out"', () => {
        render(<FarmIdentityPage {...props()} />);
        expect(screen.getByTestId('farm-page-name')).toHaveTextContent('आरवे फार्म');
        expect(screen.getByTestId('farm-page-code')).toHaveTextContent('GT4702');
        expect(screen.getByTestId('farm-boundary-missing')).toHaveTextContent('हवामान बंद आहे');
        expect(screen.getByTestId('farm-boundary-draw')).toHaveTextContent('शेताची हद्द आखा');
        expect(screen.queryByText(/Log Out|Weather pending|Draw Farm Boundary/)).toBeNull();
    });

    it('boundary drawn: "शेताची हद्द आखली", the server\'s mapped acres in Marathi digits; a weather problem in Marathi', () => {
        render(<FarmIdentityPage {...props({ farmDetails: details({ canonicalCentreLat: 18, canonicalCentreLng: 75, totalMappedAreaAcres: 2.5 }), connectError: 'providerNotConfigured' })} />);
        expect(screen.getByTestId('farm-boundary-done')).toHaveTextContent('शेताची हद्द आखली');
        expect(screen.getByTestId('farm-boundary-done')).toHaveTextContent('२.५० एकर आखलं');
        expect(screen.getByTestId('farm-weather-problem')).toHaveTextContent('हवामानाची सोय अजून सुरू झाली नाही');
        cleanup();
        render(<FarmIdentityPage {...props({ farmDetails: details({ canonicalCentreLat: 18, canonicalCentreLng: 75 }), weatherConnected: true })} />);
        expect(screen.getByTestId('farm-boundary-done-weather-on')).toHaveTextContent('शेताची हद्द आखली · हवामान जोडलं');
        expect(screen.getByTestId('farm-boundary-redraw')).toHaveTextContent('पुन्हा आखा');
    });

    it('a seat that may not change the farm setup sees no draw door', () => {
        render(<FarmIdentityPage {...props({ canEditFarmSetup: false, myFarm: { farmId: 'F1', name: 'आरवे फार्म', role: 'Worker', subscription: null } })} />);
        expect(screen.queryByTestId('farm-boundary-draw')).toBeNull();
        expect(screen.getByTestId('land-owners-only')).toBeInTheDocument();
    });

    it('Marathi mode: the page has no English word (the farm\'s name and code are data)', () => {
        render(<FarmIdentityPage {...props({ farmDetails: details({ canonicalCentreLat: 18, canonicalCentreLng: 75 }), connectError: 'failed', onOpenTeam: vi.fn() })} />);
        const text = (screen.getByTestId('farm-identity-page').textContent ?? '').replace(/GT4702/g, ' ');
        expect(text).not.toMatch(/[A-Za-z]{3,}/);
    });
});
