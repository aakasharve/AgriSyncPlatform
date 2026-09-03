// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 9 (B001, spec: 2026-08-28-labour-v2-release-1) — P10 at the cell:
 * live queue intent renders VISIBLY WEAKER than acknowledged truth, never
 * identical, never as saved. The treatment is composed from the app's own
 * existing pieces — the amber+Clock pending iconography (SyncStatusDrawer)
 * and the resolved `sync.onPhone` claim (लक्षात ठेवलं ✓) — never invented.
 *
 * The Clean-register DOM contract (HajeriLedgerClean.test.tsx) must survive
 * untouched: the pending marker lives INSIDE the cell button, so the
 * cells-per-row count and the nothing-trails rule still hold.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import HajeriLedger from '../HajeriLedger';
import HajeriCellDetail from '../HajeriCellDetail';
import { EMPTY_LABOUR_DATA } from '../../labourMock';
import type { LabourData, LedgerCell, LedgerRow } from '../../labour.types';
import { t as translate } from '../../../../i18n/translations';
import { SYNC_HONESTY_I18N_KEYS } from '../../../sync/status/syncHonestyState';

afterEach(() => cleanup());

const ON_PHONE_MR = translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr');

const cell = (over: Partial<LedgerCell>): LedgerCell => ({
    day: null, night: null, hours: null, extraHours: null, ukte: false, work: null, ...over,
});

const withRows = (rows: LedgerRow[]): LabourData => ({
    ...EMPTY_LABOUR_DATA,
    ledger: { weekLabel: '', days: ['2026-09-01', '2026-09-02'], rows, crewRows: [] },
});

const ganeshRow = (cells: (LedgerCell | null)[]): LedgerRow => ({
    personId: 'op:1', fieldOperatorId: '1', name: 'गणेश', initial: 'ग', tone: 'em', cells,
});

describe('HajeriLedger — queue intent is visible, and visibly weaker (P10)', () => {
    it('an unsynced cell draws its stated fact WITH the pending marker', () => {
        const { container } = render(<HajeriLedger
            data={withRows([ganeshRow([cell({ day: 'full' }), cell({ day: 'full', unsynced: true })])])}
            onToast={vi.fn()} />);
        const cells = container.querySelectorAll('[data-testid="ledger-cell"]');
        expect(cells).toHaveLength(2);
        // the fact renders — a hidden mark is the defect this task removes
        expect(cells[1].querySelector('svg')).not.toBeNull(); // the ✓ glyph
        expect(cells[1].querySelector('[data-testid="ledger-cell-pending"]')).not.toBeNull();
        // acknowledged cell carries NO pending marker
        expect(cells[0].querySelector('[data-testid="ledger-cell-pending"]')).toBeNull();
    });

    it('the same fact styles DIFFERENTLY unsynced vs acknowledged — weaker, never identical', () => {
        const { container } = render(<HajeriLedger
            data={withRows([ganeshRow([cell({ day: 'full' }), cell({ day: 'full', unsynced: true })])])}
            onToast={vi.fn()} />);
        const cells = container.querySelectorAll('[data-testid="ledger-cell"]');
        expect(cells[1].className).not.toBe(cells[0].className);
    });

    it('the legend explains the treatment with the resolved लक्षात ठेवलं ✓ — only when it is on screen', () => {
        const withUnsynced = render(<HajeriLedger
            data={withRows([ganeshRow([cell({ day: 'full', unsynced: true }), null])])}
            onToast={vi.fn()} />);
        expect(withUnsynced.container.textContent).toContain(ON_PHONE_MR);
        cleanup();

        const withoutUnsynced = render(<HajeriLedger
            data={withRows([ganeshRow([cell({ day: 'full' }), null])])}
            onToast={vi.fn()} />);
        expect(withoutUnsynced.container.textContent).not.toContain(ON_PHONE_MR);
    });

    it('the Clean-register DOM contract survives: one cell per day, nothing trailing', () => {
        const { container } = render(<HajeriLedger
            data={withRows([ganeshRow([cell({ day: 'full', unsynced: true }), cell({ night: 'worked', unsynced: true })])])}
            onToast={vi.fn()} />);
        const row = container.querySelector('[data-testid="ledger-row"]')!;
        const cells = row.querySelectorAll('[data-testid="ledger-cell"]');
        expect(cells).toHaveLength(2);
        expect(row.lastElementChild!.contains(cells[cells.length - 1])).toBe(true);
    });
});

describe('HajeriCellDetail — the tap-detail never presents intent as saved', () => {
    it('labels an unsynced cell with the resolved claim; an acknowledged one carries none', () => {
        const row = ganeshRow([cell({ day: 'full', unsynced: true }), cell({ day: 'full' })]);
        const unsynced = render(<HajeriCellDetail row={row} dayIndex={0} dayIso="2026-09-01" onClose={vi.fn()} />);
        expect(unsynced.container.textContent).toContain(ON_PHONE_MR);
        cleanup();

        const acknowledged = render(<HajeriCellDetail row={row} dayIndex={1} dayIso="2026-09-02" onClose={vi.fn()} />);
        expect(acknowledged.container.textContent).not.toContain(ON_PHONE_MR);
    });
});
