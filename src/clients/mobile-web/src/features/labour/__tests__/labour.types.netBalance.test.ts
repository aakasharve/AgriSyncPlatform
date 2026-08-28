/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * netBalance tests — Task 1 (spec: 2026-08-28-labour-v2-release-1, P4).
 *
 * `GetLabourDataHandler.cs:99-106` computes RecordedWages purely from
 * job-card evidence; a worker with none gets `recorded: null` (unknown), not
 * `0`. This is a SECOND site the same defect reached beyond the brief's named
 * `GetLabourDataHandler.cs:99-106` + WeeklyDashboard.tsx: `netBalance` feeds
 * `MoneyLine` (every person row on the Labour hub) and `BalanceCard`
 * (PersonDetail/MukadamDetail) — both would otherwise have kept computing
 * `null - paid - advance` (JS coerces `null` to `0`), reproducing the exact
 * "जास्त दिलं" fabrication at person granularity that Task 1 removes at the
 * farm-dashboard granularity.
 */
import { describe, it, expect } from 'vitest';
import { netBalance, type LabourBalance } from '../labour.types';

describe('netBalance — Task 1 (P4): no balance derived from an unknown recorded value', () => {
    it('returns null (unknown) when recorded is null, regardless of paid/advance', () => {
        const balance: LabourBalance = { recorded: null, paid: 4000, advance: 0 };
        expect(netBalance(balance)).toBeNull();
    });

    it('returns null even when paid is 0 too — absence of evidence is not "settled at zero"', () => {
        const balance: LabourBalance = { recorded: null, paid: 0, advance: 0 };
        expect(netBalance(balance)).toBeNull();
    });

    it('still computes an honest owe/overpaid balance once recorded is a real evidenced number', () => {
        expect(netBalance({ recorded: 5400, paid: 1200, advance: 2000 }))
            .toEqual({ owe: true, amount: 2200, isAdvance: false });
        expect(netBalance({ recorded: 0, paid: 500, advance: 0 }))
            .toEqual({ owe: false, amount: 500, isAdvance: false });
    });
});
