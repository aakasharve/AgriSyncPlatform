// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DWC v2 §2.9 — DwcReminderChip 3-state behaviour.
 *
 * The chip reads from local Dexie state (passed in via the `history`
 * prop — same shape ReflectPage already holds) and renders one of three
 * Marathi states. A 4th case verifies the FEATURE_FLAGS gate: when off,
 * the chip renders nothing.
 *
 * Per repo convention (sub-plan 04 §test-strategy) the global vitest
 * environment is 'node'; React-rendering specs opt into jsdom via the
 * directive above and import jest-dom matchers per-file.
 *
 * Vitest sets `import.meta.env.MODE = 'test'` by default, so the chip's
 * default-on-in-development gate evaluates to OFF inside tests. We mock
 * featureFlags per-test to assert both ON and OFF branches deterministically.
 *
 * Clock is pinned (vi.setSystemTime) to a fixed instant that is mid-day in
 * BOTH UTC and IST. The test builds log date keys from the runner's local
 * timezone (new Date().getFullYear()/…), while the chip derives "today" in
 * IST via DateKeyService (UTC+5:30). Near the UTC↔IST day boundary those two
 * disagree — a "today"-dated log stops matching the chip's IST "today" and the
 * state flips to TODAY_PENDING. Pinning the clock away from any day boundary
 * removes the ambiguity so both sides always see the same calendar day.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { LogVerificationStatus, type DailyLog } from '../../src/domain/types/log.types';

const FARM_ID = '11111111-1111-4111-8111-111111111111';

// Today's date key in the same format DateKeyService produces (YYYY-MM-DD).
function todayKey(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function dayKey(offsetDays: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function makeLog(overrides: Partial<DailyLog>): DailyLog {
    return {
        id: 'log-' + Math.random().toString(36).slice(2),
        date: todayKey(),
        context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['p1'], selectedPlotNames: ['P1'] }] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        financialSummary: {
            totalLabourCost: 0,
            totalInputCost: 0,
            totalMachineryCost: 0,
            grandTotal: 0,
        },
        ...overrides,
    } as DailyLog;
}

async function loadChipWithFlag(enabled: boolean) {
    vi.resetModules();
    vi.doMock('../../src/app/featureFlags', () => ({
        FEATURE_FLAGS: { DwcChip: enabled },
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
    }));
    const mod = await import('../../src/features/reflect/components/DwcReminderChip');
    return mod.default;
}

// 2026-06-15T06:30:00Z = 12:00 IST — mid-day in both UTC and IST, so the
// test's local-TZ date keys and the chip's IST date keys can never disagree
// regardless of the CI runner's timezone.
const FIXED_NOW = new Date('2026-06-15T06:30:00Z');

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    vi.resetModules();
});

afterEach(() => {
    cleanup();
    vi.doUnmock('../../src/app/featureFlags');
    vi.useRealTimers();
});

describe('DwcReminderChip', () => {
    it('renders nothing when the DwcChip feature flag is OFF', async () => {
        const Chip = await loadChipWithFlag(false);
        const { container } = render(<Chip farmId={FARM_ID} history={[]} />);
        expect(container.firstChild).toBeNull();
    });

    it('TODAY_PENDING — renders amber reminder when there is no log for today', async () => {
        const Chip = await loadChipWithFlag(true);
        // No logs at all — today is pending.
        render(<Chip farmId={FARM_ID} history={[]} />);
        const node = screen.getByTestId('dwc-reminder-chip');
        expect(node).toBeInTheDocument();
        expect(node).toHaveAttribute('data-state', 'TODAY_PENDING');
        expect(node.textContent).toMatch(/आजची नोंद बाकी/);
    });

    it('TODAY_LOGGED_PENDING_VERIFY — renders neutral chip when today has a DRAFT log', async () => {
        const Chip = await loadChipWithFlag(true);
        const log = makeLog({
            verification: {
                status: LogVerificationStatus.DRAFT,
            } as DailyLog['verification'],
        });
        render(<Chip farmId={FARM_ID} history={[log]} />);
        const node = screen.getByTestId('dwc-reminder-chip');
        expect(node).toHaveAttribute('data-state', 'TODAY_LOGGED_PENDING_VERIFY');
        expect(node.textContent).toMatch(/आज नोंद झाली/);
        expect(node.textContent).toMatch(/verification बाकी/);
    });

    it('WEEK_VERIFIED — renders verified count chip when today is verified', async () => {
        const Chip = await loadChipWithFlag(true);
        // Today verified + 2 prior days verified within last 7 days.
        const history: DailyLog[] = [
            makeLog({ date: todayKey(), verification: { status: LogVerificationStatus.VERIFIED } as DailyLog['verification'] }),
            makeLog({ date: dayKey(-1), verification: { status: LogVerificationStatus.VERIFIED } as DailyLog['verification'] }),
            makeLog({ date: dayKey(-2), verification: { status: LogVerificationStatus.CONFIRMED } as DailyLog['verification'] }),
        ];
        render(<Chip farmId={FARM_ID} history={history} />);
        const node = screen.getByTestId('dwc-reminder-chip');
        expect(node).toHaveAttribute('data-state', 'WEEK_VERIFIED');
        // The Marathi text + count number share the chip; the count is
        // rendered inside a DM Sans span.
        expect(node.textContent).toMatch(/दिवस verified/);
        const countSpan = node.querySelector('[data-testid="dwc-reminder-chip-count"]');
        expect(countSpan).not.toBeNull();
        // Count should be at least 1 (today verified). Denominator is 7.
        expect(countSpan?.textContent).toMatch(/\d+\/7/);
    });
});
