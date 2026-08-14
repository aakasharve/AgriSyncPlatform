// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PROBE A2 — RUNTIME REPRODUCTION, NOT A FIX
 * ==========================================
 *
 * Phase A §4.8 claims a shared handset does not isolate one farmer from
 * another. This file exists ONLY to make that claim true or false against the
 * real code. Nothing here is a repair, and every failing assertion below is
 * the deliverable, not a regression to be silenced.
 *
 * Three separable claims, tested separately:
 *
 *   A2.1  Per-farmer IndexedDB isolation is fused by two localStorage keys.
 *         Clear localStorage without clearing IndexedDB and the next farmer to
 *         sign in adopts the previous farmer's whole database.
 *   A2.2  localStorage is not per-farmer and logout does not clear it, so
 *         harvest / procurement / finance / vocab / farm-context / join-attempt
 *         state is shared by every farmer who signs in on the handset.
 *   A2.3  No code path anywhere deletes a farmer's database.
 *
 * MOCK DISCIPLINE
 * ---------------
 * Only the network client is mocked (`AgriSyncClient`), because a test cannot
 * reach a server. `AuthTokenStore`, `RememberDeviceStore`, `RefreshSessionStore`,
 * `tenantDekClient` and `ConsentTokenClient` are the REAL modules, so the
 * logout path under test is the production one, touching real `localStorage`.
 * Each block opens with a sanity assertion of a KNOWN-TRUE property, so a green
 * failure caused by a broken mock cannot be mistaken for a defect.
 */

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import React from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- the only mock: the network ---------------------------------------------

const mockRefreshSession = vi.fn();
const mockLogoutCurrentDevice = vi.fn();
const mockLogin = vi.fn();

vi.mock('../../api/AgriSyncClient', () => ({
    agriSyncClient: {
        get refreshSession() { return mockRefreshSession; },
        get logoutCurrentDevice() { return mockLogoutCurrentDevice; },
        get login() { return mockLogin; },
        register: vi.fn(),
    },
}));

// --- real modules under test -------------------------------------------------

import { getDatabase, resetDatabase } from '../DexieDatabase';
import { activateDatabaseForUser } from '../activateUserDatabase';
import { LEGACY_DATABASE_NAME, getLegacyDatabaseOwner } from '../userDatabaseName';
import { getActiveDatabaseName } from '../activeDatabaseName';
import { storageNamespace } from '../StorageNamespace';
import { SessionStore } from '../SessionStore';
import {
    writeHarvestConfigRaw, readHarvestConfigRaw,
    writeHarvestSessionsRaw, readHarvestSessionsRaw,
    writeOtherIncomeRaw, readOtherIncomeRaw,
} from '../HarvestLegacyStore';
import { writeProcurementExpensesRaw, readProcurementExpensesRaw } from '../ProcurementLegacyStore';
import { writeFinanceSettingsRaw, readFinanceSettingsRaw } from '../FinanceLegacyStore';
import { writeVocabRaw, readVocabRaw } from '../VocabStore';
import { writeJoinAttemptsRaw, readJoinAttemptsRaw } from '../FarmInviteStore';
import { AuthProvider, useAuth } from '../../../app/providers/AuthProvider';

const FARMER_A = 'user-aaaa-1111';
const FARMER_B = 'user-bbbb-2222';
const DB_FOR_A = `AgriLogDB_u_${encodeURIComponent(FARMER_A)}`;
const DB_FOR_B = `AgriLogDB_u_${encodeURIComponent(FARMER_B)}`;
const NOW = '2026-08-14T09:00:00.000Z';

const A_PLOT = 'plot-a-1';
const A_CROP = 'crop-a-1';

async function fullWipe(): Promise<void> {
    await resetDatabase();
    for (const name of [LEGACY_DATABASE_NAME, DB_FOR_A, DB_FOR_B]) {
        await Dexie.delete(name);
    }
    localStorage.clear();
    storageNamespace.setNamespace('user');
    await resetDatabase();
}

/** One row only farmer A should ever be able to read. */
async function seedPrivateRowForFarmerA(): Promise<void> {
    await getDatabase().appMeta.put({
        key: 'a_private_marker',
        value: 'FARMER_A_PRIVATE_PAYLOAD',
        updatedAt: NOW,
    });
}

// =============================================================================
// A2.1 — database adoption after localStorage is cleared
// =============================================================================

describe('A2.1 — a cleared localStorage must not hand one farmer another farmer\'s database', () => {
    beforeEach(fullWipe);
    afterEach(fullWipe);

    it('SANITY: per-farmer isolation holds while localStorage survives (known-true)', async () => {
        activateDatabaseForUser(FARMER_A);
        await seedPrivateRowForFarmerA();
        expect(getActiveDatabaseName()).toBe(LEGACY_DATABASE_NAME);
        expect(getLegacyDatabaseOwner()).toBe(FARMER_A);

        activateDatabaseForUser(FARMER_B);

        expect(getActiveDatabaseName()).toBe(DB_FOR_B);
        await expect(getDatabase().appMeta.get('a_private_marker')).resolves.toBeUndefined();
    });

    it('farmer_B_cannot_read_farmer_A_records_after_localStorage_is_cleared_but_indexeddb_survives', async () => {
        // Farmer A's handset today: A owns AgriLogDB and has records in it.
        activateDatabaseForUser(FARMER_A);
        await seedPrivateRowForFarmerA();
        expect(getLegacyDatabaseOwner()).toBe(FARMER_A);

        // A privacy mode / "clear cookies and site data" pass that drops
        // localStorage while leaving IndexedDB in place. Nothing touches the
        // Dexie databases — only the two keys the routing depends on.
        localStorage.clear();
        // ...then the app is relaunched: the in-memory handle and the resolved
        // name are gone, so routing is re-derived from durable state alone.
        await resetDatabase();

        // Farmer B signs in on the same handset.
        activateDatabaseForUser(FARMER_B);

        // SECURITY PROPERTY: B must not be routed onto the database A owns...
        expect(getActiveDatabaseName()).not.toBe(LEGACY_DATABASE_NAME);
        // ...and must not be able to read a single row of A's.
        await expect(getDatabase().appMeta.get('a_private_marker')).resolves.toBeUndefined();
    });

    it('farmer_B_cannot_read_farmer_A_private_row_after_localStorage_is_cleared', async () => {
        // Same scenario as above, asserting the READ rather than the routing,
        // so the leak is evidenced directly and not only inferred from a name.
        activateDatabaseForUser(FARMER_A);
        await seedPrivateRowForFarmerA();

        localStorage.clear();
        await resetDatabase();

        activateDatabaseForUser(FARMER_B);

        const leaked = await getDatabase().appMeta.get('a_private_marker');
        expect(leaked?.value).toBeUndefined();
    });

    it('farmer_A_keeps_access_to_own_records_after_localStorage_is_cleared', async () => {
        activateDatabaseForUser(FARMER_A);
        await seedPrivateRowForFarmerA();

        localStorage.clear();
        await resetDatabase();

        // B signs in first after the clear, then A comes back.
        activateDatabaseForUser(FARMER_B);
        activateDatabaseForUser(FARMER_A);

        // DURABILITY PROPERTY: A's own records are still reachable to A.
        const row = await getDatabase().appMeta.get('a_private_marker');
        expect(row?.value).toBe('FARMER_A_PRIVATE_PAYLOAD');
    });
});

// =============================================================================
// A2.2 — localStorage is not per-farmer, and logout does not clear it
// =============================================================================

/** Probe exposing the REAL logout and login off the REAL AuthProvider. */
function AuthProbe(): React.ReactElement {
    const { logout, login, authStatus } = useAuth();
    return React.createElement('div', null,
        React.createElement('span', { 'data-testid': 'auth-status' }, authStatus),
        React.createElement('button', {
            'data-testid': 'logout-btn',
            onClick: () => { void logout(); },
        }),
        React.createElement('button', {
            'data-testid': 'login-btn',
            onClick: () => { void login('8888888888', 'pw', false); },
        }),
    );
}

async function renderAuthenticatedAs(userId: string): Promise<void> {
    mockRefreshSession.mockResolvedValueOnce({
        userId, accessToken: 'tok', expiresAtUtc: '2099-01-01T00:00:00Z',
    });
    render(React.createElement(AuthProvider, null, React.createElement(AuthProbe)));
    await waitFor(() => {
        expect(screen.getByTestId('auth-status').textContent).toBe('authenticated');
    });
}

/** Farmer A signs in, writes their data, and logs out through the real path. */
async function farmerASignsInWritesAndLogsOut(): Promise<void> {
    await renderAuthenticatedAs(FARMER_A);
    activateDatabaseForUser(FARMER_A);

    writeHarvestConfigRaw(A_PLOT, JSON.stringify({ ratePerKg: 42, owner: FARMER_A }));
    writeHarvestSessionsRaw(A_PLOT, A_CROP, JSON.stringify([{ kg: 900, owner: FARMER_A }]));
    writeOtherIncomeRaw(JSON.stringify([{ amount: 7000, owner: FARMER_A }]));
    writeProcurementExpensesRaw(JSON.stringify([{ amount: 12345, owner: FARMER_A }]));
    writeFinanceSettingsRaw(JSON.stringify({ gstNumber: 'A-GST-27', owner: FARMER_A }));
    writeVocabRaw(JSON.stringify({ mappings: { 'भात': 'rice' }, owner: FARMER_A }));
    SessionStore.setCurrentFarmId('farm-belonging-to-A');
    writeJoinAttemptsRaw(JSON.stringify({ count: 5, owner: FARMER_A }));

    mockLogoutCurrentDevice.mockResolvedValueOnce(undefined);
    await act(async () => { screen.getByTestId('logout-btn').click(); });
    await waitFor(() => {
        expect(screen.getByTestId('auth-status').textContent).toBe('anonymous');
    });
}

/** Farmer B signs in on the same handset, through the real login path. */
async function farmerBSignsIn(): Promise<void> {
    mockLogin.mockResolvedValueOnce({
        userId: FARMER_B, accessToken: 'tok-b', expiresAtUtc: '2099-01-01T00:00:00Z',
    });
    await act(async () => { screen.getByTestId('login-btn').click(); });
    await waitFor(() => {
        expect(screen.getByTestId('auth-status').textContent).toBe('authenticated');
    });
    activateDatabaseForUser(FARMER_B);
}

describe('A2.2 — one farmer\'s localStorage must not survive into the next farmer\'s session', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await fullWipe();
    });
    afterEach(async () => {
        cleanup();
        await fullWipe();
    });

    it('SANITY: the real logout DOES clear the auth session key (known-true)', async () => {
        await renderAuthenticatedAs(FARMER_A);
        localStorage.setItem('agrisync_auth_session_v1', JSON.stringify({ userId: FARMER_A }));
        localStorage.setItem('agrisync_remember_device_v1', 'true');

        mockLogoutCurrentDevice.mockResolvedValueOnce(undefined);
        await act(async () => { screen.getByTestId('logout-btn').click(); });
        await waitFor(() => {
            expect(screen.getByTestId('auth-status').textContent).toBe('anonymous');
        });

        // If these two are not gone, the mocks are wrong and every assertion
        // below this point is worthless.
        expect(localStorage.getItem('agrisync_auth_session_v1')).toBeNull();
        expect(localStorage.getItem('agrisync_remember_device_v1')).toBeNull();
    });

    it('SANITY: the write adapters really do persist and read back (known-true)', async () => {
        writeProcurementExpensesRaw(JSON.stringify([{ amount: 1 }]));
        expect(readProcurementExpensesRaw()).toBe('[{"amount":1}]');
    });

    it('farmer_B_cannot_read_farmer_A_harvest_data_after_logout', async () => {
        await farmerASignsInWritesAndLogsOut();
        await farmerBSignsIn();

        expect(readHarvestConfigRaw(A_PLOT)).toBeNull();
        expect(readHarvestSessionsRaw(A_PLOT, A_CROP)).toBeNull();
        expect(readOtherIncomeRaw()).toBeNull();
    });

    it('farmer_B_cannot_read_farmer_A_procurement_expenses_after_logout', async () => {
        await farmerASignsInWritesAndLogsOut();
        await farmerBSignsIn();

        expect(readProcurementExpensesRaw()).toBeNull();
    });

    it('farmer_B_cannot_read_farmer_A_finance_settings_after_logout', async () => {
        await farmerASignsInWritesAndLogsOut();
        await farmerBSignsIn();

        expect(readFinanceSettingsRaw()).toBeNull();
    });

    it('farmer_B_cannot_read_farmer_A_voice_vocabulary_after_logout', async () => {
        await farmerASignsInWritesAndLogsOut();
        await farmerBSignsIn();

        expect(readVocabRaw()).toBeNull();
    });

    it('farmer_B_is_not_placed_into_farmer_A_farm_context_after_logout', async () => {
        await farmerASignsInWritesAndLogsOut();
        await farmerBSignsIn();

        expect(SessionStore.getCurrentFarmId()).toBeNull();
    });

    it('farmer_B_does_not_inherit_farmer_A_join_attempt_rate_limit_after_logout', async () => {
        await farmerASignsInWritesAndLogsOut();
        await farmerBSignsIn();

        expect(readJoinAttemptsRaw()).toBeNull();
    });

    it('the_storage_namespace_discriminates_by_farmer_not_only_by_demo_mode', async () => {
        // The single mechanism every namespaced key depends on. If it cannot
        // tell two farmers apart, no namespaced key can.
        storageNamespace.setNamespace('user');
        activateDatabaseForUser(FARMER_A);
        const keyForA = storageNamespace.getKey('harvest_other_income');

        activateDatabaseForUser(FARMER_B);
        const keyForB = storageNamespace.getKey('harvest_other_income');

        expect(keyForB).not.toBe(keyForA);
    });

    it('SessionStore_clearCurrentFarmId_has_at_least_one_production_caller', () => {
        const src = resolve(__dirname, '../../..');
        const hits: string[] = [];
        walkProductionSources(src, file => {
            if (file.endsWith('SessionStore.ts')) return;
            if (readFileSync(file, 'utf8').includes('clearCurrentFarmId')) {
                hits.push(file);
            }
        });
        expect(hits).not.toEqual([]);
    });
});

// =============================================================================
// A2.3 — no database is ever deleted
// =============================================================================

/** Every non-test source file under `src/`. */
function walkProductionSources(dir: string, visit: (file: string) => void): void {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === 'node_modules' || entry === '__tests__' || entry === '__mocks__') continue;
            walkProductionSources(full, visit);
            continue;
        }
        if (!/\.(ts|tsx|js|jsx)$/.test(entry)) continue;
        if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry)) continue;
        visit(full);
    }
}

describe('A2.3 — a farmer\'s database must be removable from a shared handset', () => {
    it('a_farmer_database_can_be_deleted_somewhere_in_production_code', () => {
        const src = resolve(__dirname, '../../..');
        const deleters: string[] = [];
        walkProductionSources(src, file => {
            const text = readFileSync(file, 'utf8');
            if (/deleteDatabase\s*\(|Dexie\s*\.\s*delete\s*\(/.test(text)) {
                deleters.push(file.replace(src, 'src'));
            }
        });
        // Nothing on this handset can remove a farmer's history if this is empty.
        expect(deleters).not.toEqual([]);
    });

    it('SANITY: the source walker can find a string that certainly exists (known-true)', () => {
        const src = resolve(__dirname, '../../..');
        const found: string[] = [];
        walkProductionSources(src, file => {
            if (readFileSync(file, 'utf8').includes('LEGACY_DATABASE_NAME')) {
                found.push(file);
            }
        });
        expect(found.length).toBeGreaterThan(0);
    });
});
