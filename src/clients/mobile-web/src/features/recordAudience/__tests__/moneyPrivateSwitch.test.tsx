// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S5.1; founder 27 Nov follow-up 2 "पैशांच्या नोंदी फक्त मला दिसू दे";
 * CTO ruling Q5 A) - the farm's registrant's own line in माझी टीम. It reads the farm's value from the pull (`accessScopes[].moneyPrivate`, present
 * only when on), changes it offline first through `farm.money_private.set` (the payload the contract checks), shows a change not yet on the server
 * as waiting, and a second tap while it waits replaces it (never two rows). Its limit is written under it (उक्ते काम pay and the हजेरी day-wage are
 * not covered yet), and that it reaches NEW records only (founder 1-B). Nobody but the registrant is shown it.
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

import { MoneyPrivateSwitch } from '../MoneyPrivateSwitch';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { ACCESS_SCOPES_META_KEY } from '../../../infrastructure/storage/accessScopeStore';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../infrastructure/sync/PayloadValidator';
import type { FarmAccessScopeDto } from '../../../infrastructure/api/accessScopeDtos';

configure({ asyncUtilTimeout: 5000 });

const FARM = '3d030000-0000-4000-8000-0000000000b2';
const ME = 'a1a1a1a1-0000-4000-8000-0000000000b1';
const scope = (over: Partial<FarmAccessScopeDto> = {}): FarmAccessScopeDto => ({ farmId: FARM, ownRecordsOnly: false, seeMoney: true, seeWages: true, seeAttendance: true, seeTests: true, seeCompliance: true, seeFarmOverview: true, ...over });
const queue = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

beforeEach(async () => {
    await resetDatabase();
    await Promise.all([getDatabase().mutationQueue.clear(), getDatabase().appMeta.clear()]);
    await getDatabase().farms.put({ id: FARM, payload: { id: FARM, ownerUserId: ME }, updatedAt: 'T' });
});
afterEach(() => cleanup());

describe('PERM S5.1 - "पैशांच्या नोंदी फक्त मला दिसू दे"', () => {
    it('the money line is drawn for the registrant only and queues farm.money_private.set', async () => {
        await getDatabase().appMeta.put({ key: ACCESS_SCOPES_META_KEY, value: { receivedAtUtc: 'x', scopes: [scope()] }, updatedAt: 'x' });
        render(<MoneyPrivateSwitch farmId={FARM} selfUserId={ME} />);
        const sw = await screen.findByTestId('money-private-switch');
        const line = screen.getByTestId('money-private');
        expect(line).toHaveTextContent('पैशांच्या नोंदी फक्त मला दिसू दे');
        expect(line).toHaveTextContent('उक्ते कामाचे पैसे आणि हजेरीवरची रोजची मजुरी यात अजून येत नाहीत — ती "इतरांची मजुरी पाहणे" प्रमाणेच दिसते.');
        expect(sw).toHaveAttribute('aria-checked', 'false');
        await act(async () => { fireEvent.click(sw); });
        await waitFor(async () => expect(await queue()).toHaveLength(1));
        const [row] = await queue();
        expect(row.mutationType).toBe(SyncMutationName.FarmMoneyPrivateSet);
        expect(row.payload).toEqual({ farmId: FARM, isPrivate: true });
        expect(validatePayload(row.mutationType, row.payload).ok).toBe(true);
        await waitFor(() => expect(screen.getByTestId('money-private-switch')).toHaveAttribute('aria-checked', 'true'));
        expect(screen.getByTestId('money-private')).toHaveTextContent('यापुढच्या खर्च, बिलं आणि कामातील पैसे फक्त तुम्हाला आणि ज्याने नोंद केली त्याला दिसतील. आधीच्या नोंदी आहेत तशाच राहतील.');
        expect(screen.getByTestId('setup-waiting')).toHaveTextContent('अजून सर्व्हरवर गेलं नाही — नेट आल्यावर जाईल.');
        // a second tap while it waits replaces the waiting change: never two rows
        await act(async () => { fireEvent.click(screen.getByTestId('money-private-switch')); });
        await waitFor(async () => expect(((await queue())[0].payload as { isPrivate: boolean }).isPrivate).toBe(false));
        expect(await queue()).toHaveLength(1);
    });

    it('on when the farm says so; nothing for a person who is not the farm\'s registrant', async () => {
        await getDatabase().appMeta.put({ key: ACCESS_SCOPES_META_KEY, value: { receivedAtUtc: 'x', scopes: [scope({ moneyPrivate: true })] }, updatedAt: 'x' });
        const { unmount } = render(<MoneyPrivateSwitch farmId={FARM} selfUserId={ME} />);
        await waitFor(() => expect(screen.getByTestId('money-private-switch')).toHaveAttribute('aria-checked', 'true'));
        unmount();
        const { container } = render(<MoneyPrivateSwitch farmId={FARM} selfUserId="someone-else" />);
        await act(async () => { await new Promise(r => setTimeout(r, 30)); });
        expect(container).toBeEmptyDOMElement();
    });
});
