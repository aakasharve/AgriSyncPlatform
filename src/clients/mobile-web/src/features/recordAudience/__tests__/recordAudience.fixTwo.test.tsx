// @vitest-environment jsdom
/**
 * spec: plr-d10 lane PRV fix pass 2 — the "कोण पाहू शकतो" row is offered only to the farm's REGISTRANT (its ownerUserId
 * as this phone holds the farm): a second PrimaryOwner seat is never offered a choice the server would refuse. Real Dexie
 * (fake-indexeddb).
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: 'mr' }) }));
vi.mock('../../../core/navigation/useBackDismiss', () => ({ useBackDismiss: () => undefined }));

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { AudienceRow } from '../AudienceRow';
import { isFarmRegistrant } from '../recordHolder';

const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const row = (selfUserId: string | null) => (
    <AudienceRow kind="DailyLog" recordIds={['r1']} farmId={FARM} selfUserId={selfUserId} audience={null} chosen={[]}
        madeBySomeoneElse={false} testId="aud" />
);
const settle = () => new Promise(r => setTimeout(r, 30));

beforeEach(async () => {
    await getDatabase().open();
    await Promise.all(getDatabase().tables.map(t => t.clear()));
});
afterEach(() => cleanup());

describe('the audience row is the registrant\'s alone (fix pass 2)', () => {
    it('shows for the farm\'s registrant', async () => {
        await getDatabase().farms.put({ id: FARM, payload: { id: FARM, ownerUserId: ME }, updatedAt: 'T' });
        render(row(ME));
        await waitFor(() => expect(screen.getByTestId('aud')).toBeInTheDocument());
    });

    it('never shows for a second PrimaryOwner seat, an unknown farm or an unknown person', async () => {
        await getDatabase().farms.put({ id: FARM, payload: { id: FARM, ownerUserId: OTHER }, updatedAt: 'T' });
        render(row(ME));
        await settle();
        expect(screen.queryByTestId('aud')).toBeNull();
        cleanup();

        await getDatabase().farms.clear();
        render(row(ME));
        await settle();
        expect(screen.queryByTestId('aud')).toBeNull();
        cleanup();

        await getDatabase().farms.put({ id: FARM, payload: { id: FARM, ownerUserId: ME }, updatedAt: 'T' });
        render(row(null));
        await settle();
        expect(screen.queryByTestId('aud')).toBeNull();
        expect(await isFarmRegistrant(FARM, ME.toUpperCase())).toBe(true);
    });
});
