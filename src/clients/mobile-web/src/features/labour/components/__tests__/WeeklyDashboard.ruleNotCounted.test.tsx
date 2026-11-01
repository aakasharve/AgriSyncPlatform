// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane PRV fix pass 1 (M4) — the labour page's totals (man-days in the window, the crew money on its
 * all-time basis) count only the work records he may see. When the server says a work record was left out by rule on
 * THIS farm, the totals say so in the founder's W4 words; another farm's, a money-only, or an out-of-window day says
 * nothing (never a false "incomplete").
 *
 * Revert-proof: drop the two `RuleNotCountedNote`s from `WeeklyDashboard` and the first test fails.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import WeeklyDashboard from '../WeeklyDashboard';
import type { LabourData } from '../../labourMock';
import { LABOUR_MOCK } from '../../labourMock';
import { ruleWithheldCopy } from '../../../../i18n/ruleWithheldTranslations';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { ACCESS_SCOPES_META_KEY } from '../../../../infrastructure/storage/accessScopeStore';
import type { FarmAccessScopeDto } from '../../../../infrastructure/api/accessScopeDtos';

vi.mock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: 'mr' }) }));

const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const OTHER = 'bbbbbbbb-0000-4000-8000-00000000000b';

const baseProps = () => ({
    onReview: vi.fn(),
    onLedger: vi.fn(),
    onToast: vi.fn(),
    timeWindow: 'week' as const,
    onTimeWindowChange: vi.fn(),
});

const data: LabourData = {
    ...LABOUR_MOCK,
    dashboard: {
        ...LABOUR_MOCK.dashboard,
        windowFrom: '2026-10-25',
        windowTo: '2026-10-31',
        money: { recorded: 16800, paid: 8400, advance: 3000, owed: 5400 },
    },
};

const storeScopes = async (farmId: string, days: FarmAccessScopeDto['withheldRecordDays']) => {
    await getDatabase().appMeta.put({
        key: ACCESS_SCOPES_META_KEY,
        value: {
            receivedAtUtc: 'T',
            scopes: [{
                farmId, ownRecordsOnly: false, seeMoney: true, seeWages: true, seeAttendance: true, seeTests: true,
                seeCompliance: true, seeFarmOverview: true, withheldRecordDays: days,
            }],
        },
        updatedAt: 'T',
    });
};

const settle = () => new Promise(r => setTimeout(r, 30));

beforeEach(async () => {
    await getDatabase().open();
    await Promise.all(getDatabase().tables.map(t => t.clear()));
});
afterEach(() => cleanup());

describe('the labour totals say when a work record is left out by rule (W4)', () => {
    it('shows W4 under the window figures and under the crew money when a work day in the window is left out', async () => {
        await storeScopes(FARM, [{ kind: 'work', date: '2026-10-30' }]);
        render(<WeeklyDashboard {...baseProps()} data={data} farmId={FARM} />);
        const words = ruleWithheldCopy('mr').notCounted;
        await waitFor(() => expect(screen.getByTestId('labour-not-counted')).toHaveTextContent(words));
        expect(screen.getByTestId('labour-money-not-counted')).toHaveTextContent(words);
    });

    it('the window figures stay silent for a day outside the window; the all-time crew money still says it', async () => {
        await storeScopes(FARM, [{ kind: 'work', date: '2026-09-01' }]);
        render(<WeeklyDashboard {...baseProps()} data={data} farmId={FARM} />);
        await waitFor(() => expect(screen.getByTestId('labour-money-not-counted')).toBeInTheDocument());
        expect(screen.queryByTestId('labour-not-counted')).toBeNull();
    });

    it('says nothing for another farm, or for a money record (it is not a work total)', async () => {
        await storeScopes(OTHER, [{ kind: 'work', date: '2026-10-30' }]);
        render(<WeeklyDashboard {...baseProps()} data={data} farmId={FARM} />);
        await settle();
        expect(screen.queryByTestId('labour-not-counted')).toBeNull();
        expect(screen.queryByTestId('labour-money-not-counted')).toBeNull();
        cleanup();

        await storeScopes(FARM, [{ kind: 'money', date: '2026-10-30' }]);
        render(<WeeklyDashboard {...baseProps()} data={data} farmId={FARM} />);
        await settle();
        expect(screen.queryByTestId('labour-not-counted')).toBeNull();
        expect(screen.queryByTestId('labour-money-not-counted')).toBeNull();
    });
});
