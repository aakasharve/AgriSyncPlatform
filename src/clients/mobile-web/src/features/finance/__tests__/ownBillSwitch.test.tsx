// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-177, phone task P12; founder 27 Nov B1.4: "an owner switch for each farm; off unless the
 * owner turns it on") - may a money checker approve a bill he made himself. The pull says so per farm (`accessScopes[].reviewerMayApproveOwnBill: true`,
 * written ONLY when on; absent = off). The phone draws the button by the farm's value; the server decides again when the approval arrives. The switch
 * is for the primary owner only, queued as `farm.own_bill_approval.set` (offline first), a waiting change shown as waiting, never two rows.
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
vi.mock('../../../i18n/LanguageContext', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language: 'mr' }),
}));

import { billApprovalSeat } from '../billApproval';
import { OwnBillApprovalSwitch } from '../OwnBillApprovalSwitch';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { ACCESS_SCOPES_META_KEY } from '../../../infrastructure/storage/accessScopeStore';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../infrastructure/sync/PayloadValidator';
import type { FarmAccessScopeDto } from '../../../infrastructure/api/accessScopeDtos';

// The screens follow Dexie live queries: under a loaded whole-suite run an update can take longer than the 1 s default (seen 27 Nov), so the
// waits here allow 5 s. A wait that never comes still fails.
configure({ asyncUtilTimeout: 5000 });

const FARM = '3d030000-0000-4000-8000-0000000000a1';
const reviewer = { role: 'Mukadam', authorities: [{ name: 'SeeMoney' }, { name: 'ReviewMoney' }] } as never;
const owner = { role: 'PrimaryOwner', authorities: undefined } as never;
const ownBill = { plotId: 'p', createdByUserId: 'u-me' };
const scope = (over: Partial<FarmAccessScopeDto> = {}): FarmAccessScopeDto => ({ farmId: FARM, ownRecordsOnly: false, seeMoney: true, seeWages: true, seeAttendance: true, seeTests: true, seeCompliance: true, seeFarmOverview: true, ...over });
const queue = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

beforeEach(async () => {
    await resetDatabase();
    await Promise.all([getDatabase().mutationQueue.clear(), getDatabase().appMeta.clear()]);
});
afterEach(() => cleanup());

describe('D-177: a checker\'s own bill (P12)', () => {
    it('a checker sees the button on his own bill only when the farm allows', () => {
        expect(billApprovalSeat(reviewer, scope(), ownBill, 'u-me')).toBe('ownBill');
        expect(billApprovalSeat(reviewer, scope({ reviewerMayApproveOwnBill: false }), ownBill, 'u-me')).toBe('ownBill');
        expect(billApprovalSeat(reviewer, undefined, ownBill, 'u-me')).toBe('ownBill');
        expect(billApprovalSeat(reviewer, scope({ reviewerMayApproveOwnBill: true }), ownBill, 'u-me')).toBe('may');
        // another person's bill and the owner are as before
        expect(billApprovalSeat(reviewer, scope(), { plotId: 'p', createdByUserId: 'u-other' }, 'u-me')).toBe('may');
        expect(billApprovalSeat(owner, scope(), { plotId: 'p', createdByUserId: 'u-owner' }, 'u-owner')).toBe('may');
        // the switch never widens who may approve at all, nor a chosen-plots seat's plots
        expect(billApprovalSeat({ role: 'Worker', authorities: [] } as never, scope({ reviewerMayApproveOwnBill: true }), ownBill, 'u-me')).toBe('no');
        expect(billApprovalSeat(reviewer, scope({ reviewerMayApproveOwnBill: true, plotScope: 'ChosenPlots', plotIds: ['q'] }), ownBill, 'u-me')).toBe('no');
    });

    it('the owner\'s switch: off by default, reads the farm\'s value, queues the change, and a second tap while it waits replaces it', async () => {
        await getDatabase().appMeta.put({ key: ACCESS_SCOPES_META_KEY, value: { receivedAtUtc: 'x', scopes: [scope()] }, updatedAt: 'x' });
        render(<OwnBillApprovalSwitch farmId={FARM} isPrimaryOwner />);
        const sw = await screen.findByTestId('own-bill-switch');
        expect(screen.getByTestId('own-bill-approval')).toHaveTextContent('पैसे तपासणारी व्यक्ती स्वतः केलेलं बिल स्वतः मंजूर करू शकते');
        expect(screen.getByTestId('own-bill-approval')).toHaveTextContent('बंद असेल तर असं बिल तुम्ही किंवा दुसरी परवानगी असलेली व्यक्ती मंजूर करेल.');
        expect(sw).toHaveAttribute('aria-checked', 'false');
        await act(async () => { fireEvent.click(sw); });
        await waitFor(async () => expect(await queue()).toHaveLength(1));
        const [row] = await queue();
        expect(row.mutationType).toBe(SyncMutationName.FarmOwnBillApprovalSet);
        expect(row.payload).toEqual({ farmId: FARM, allowed: true });
        expect(validatePayload(row.mutationType, row.payload).ok).toBe(true);
        await waitFor(() => expect(screen.getByTestId('own-bill-switch')).toHaveAttribute('aria-checked', 'true'));
        expect(screen.getByTestId('setup-waiting')).toHaveTextContent('अजून सर्व्हरवर गेलं नाही — नेट आल्यावर जाईल.');
        await act(async () => { fireEvent.click(screen.getByTestId('own-bill-switch')); });
        await waitFor(async () => expect(((await queue())[0].payload as { allowed: boolean }).allowed).toBe(false));
        expect(await queue()).toHaveLength(1);
    });

    it('on when the farm says so; drawn for the primary owner only', async () => {
        await getDatabase().appMeta.put({ key: ACCESS_SCOPES_META_KEY, value: { receivedAtUtc: 'x', scopes: [scope({ reviewerMayApproveOwnBill: true })] }, updatedAt: 'x' });
        const { unmount } = render(<OwnBillApprovalSwitch farmId={FARM} isPrimaryOwner />);
        await waitFor(() => expect(screen.getByTestId('own-bill-switch')).toHaveAttribute('aria-checked', 'true'));
        unmount();
        const { container } = render(<OwnBillApprovalSwitch farmId={FARM} isPrimaryOwner={false} />);
        await act(async () => { await new Promise(r => setTimeout(r, 20)); });
        expect(container).toBeEmptyDOMElement();
    });
});
