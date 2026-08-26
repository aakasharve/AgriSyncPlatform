// @vitest-environment jsdom
/**
 * Labour V1 FINAL FIX C2 — the labour sheet must not manufacture statements.
 *
 * THE GATE THIS LOCKS. The sheet used to open with
 * `maleCount/femaleCount/count/totalCost` all set to 0, and the auto-total
 * effect re-wrote `totalCost: 0, count: 0` on mount for good measure. Those
 * zeros were form defaults, and they did not stay in the form:
 * `buildLabourPayloads` sends any finite/integer value INCLUDING 0, the server
 * preserves NULL only when all three headcounts are null, and
 * `LabourAssignment.TotalCost` is documented as "NULL when not stated… never
 * computed". So the client was writing "₹0 was stated" and "0 workers were
 * stated" into the canonical record on every contract or self engagement — a
 * constant wearing the costume of a measurement — and there is no backfill job
 * in this system to take it back.
 *
 * The fix is at the origin rather than at the payload boundary, because the
 * boundary cannot tell a typed 0 from a seeded 0: by the time
 * `buildLabourPayloads` sees the event, both are just `0`. So the two
 * properties below are the whole contract, and they pull in opposite
 * directions on purpose:
 *
 *   1. Untouched fields are ABSENT — not 0.
 *   2. A 0 the farmer actually typed is still 0. Silence is not data; a stated
 *      zero is.
 *
 * spec: 2026-07-13-labour-attendance-approval-design
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DetailSheet from '../DetailSheet';
import type { LedgerDefaults, FarmerProfile, Plot } from '../../../../../../types';

const defaults = {
    labour: {
        defaultWage: 400,
        defaultHours: 8,
        shifts: [{ id: 'full', name: 'Full Day', defaultRateMale: 500, defaultRateFemale: 400 }],
    },
    irrigation: { method: 'Drip', source: 'Well', defaultDuration: 2 },
    machinery: { defaultRentalCost: 1000, defaultFuelCost: 200 },
} as unknown as LedgerDefaults;

const profile = { name: 'Tester', motors: [], waterResources: [] } as unknown as FarmerProfile;

/**
 * A BRAND-NEW labour entry — `data` empty, so the sheet runs its own
 * initializer. This is the exact path that produced the fabricated zeros.
 */
function renderFreshLabourSheet(currentPlot?: Plot) {
    const onSave = vi.fn();
    render(
        <DetailSheet
            type="labour"
            data={{}}
            defaults={defaults}
            profile={profile}
            currentPlot={currentPlot}
            onSave={onSave}
            onClose={() => { }}
        />
    );
    return { onSave };
}

/** The numeric inputs, found the same way the existing sheet tests find them. */
function input(labelText: string): HTMLInputElement {
    const label = screen.getByText(labelText);
    return label.parentElement!.querySelector('input') as HTMLInputElement;
}

function confirm() {
    fireEvent.click(screen.getByText('Confirm Details'));
}

const has = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

describe('DetailSheet labour — an untouched field is silence, not zero', () => {
    afterEach(() => cleanup());

    it('a labour event the farmer never touched carries NO headcounts and NO total', () => {
        const { onSave } = renderFreshLabourSheet();

        confirm();

        const saved = onSave.mock.calls[0][0];
        // Key ABSENCE, not just a falsy value: `buildLabourPayloads` forwards
        // any finite number, so a present 0 would reach the server as a stated
        // headcount and `LabourHeadcount.Resolve(0, null, null)` would store it.
        expect(has(saved, 'maleCount')).toBe(false);
        expect(has(saved, 'femaleCount')).toBe(false);
        expect(has(saved, 'count')).toBe(false);
        expect(has(saved, 'totalCost')).toBe(false);
        // And nothing survives a JSON round-trip either.
        expect(JSON.stringify(saved)).not.toContain('totalCost');
        expect(JSON.stringify(saved)).not.toContain('maleCount');
    });

    it('still records what the farmer CAN see he chose — the engagement type and shift', () => {
        // These two are not the same case as the numbers: both are visibly
        // reflected in the UI (selected tab, highlighted shift chip), so they
        // are shown defaults rather than silent claims about a quantity.
        const { onSave } = renderFreshLabourSheet();

        confirm();

        expect(onSave.mock.calls[0][0].type).toBe('HIRED');
        expect(onSave.mock.calls[0][0].shiftId).toBe('full');
    });

    it('the auto-total effect no longer re-seeds the zeros it used to write on mount', () => {
        // The effect fires on mount because a shift is pre-selected. Before the
        // fix it wrote `totalCost: 0, count: 0` immediately, which would have
        // made removing the initializer zeros pointless.
        const { onSave } = renderFreshLabourSheet();

        confirm();

        expect(onSave.mock.calls[0][0].totalCost).toBeUndefined();
        expect(onSave.mock.calls[0][0].count).toBeUndefined();
    });
});

describe('DetailSheet labour — a stated zero is data and must survive', () => {
    afterEach(() => cleanup());

    it('typing 0 into Total Labours sends a real 0, not an omission', () => {
        const { onSave } = renderFreshLabourSheet();

        fireEvent.change(input('Total Labours'), { target: { value: '0' } });
        confirm();

        const saved = onSave.mock.calls[0][0];
        expect(saved.count).toBe(0);
        expect(has(saved, 'count')).toBe(true);
    });

    it('typing 0 into a split states the split AND the total it derives', () => {
        const { onSave } = renderFreshLabourSheet();

        fireEvent.change(input('Male Split'), { target: { value: '0' } });
        confirm();

        const saved = onSave.mock.calls[0][0];
        expect(saved.maleCount).toBe(0);
        // Once a headcount exists the derivation is legitimate again: this 0 is
        // computed from something the farmer said, not from silence.
        expect(saved.totalCost).toBe(0);
        expect(saved.count).toBe(0);
    });
});

describe('DetailSheet labour — the auto-total display still works', () => {
    afterEach(() => cleanup());

    it('one keystroke in Male Split fills Total Paid (Auto) exactly as before', () => {
        const { onSave } = renderFreshLabourSheet();

        fireEvent.change(input('Male Split'), { target: { value: '3' } });

        // Read off the rendered "Total Paid (Auto)" box, not just the saved object.
        const money = screen.getByText('Total Paid (Auto)').closest('div')!
            .parentElement!.querySelector('input') as HTMLInputElement;
        expect(money.value).toBe('1500');

        confirm();
        expect(onSave.mock.calls[0][0].totalCost).toBe(1500);
        expect(onSave.mock.calls[0][0].count).toBe(3);
    });

    it('both splits still add up across the two shift rates', () => {
        const { onSave } = renderFreshLabourSheet();

        fireEvent.change(input('Male Split'), { target: { value: '3' } });
        fireEvent.change(input('Female Split'), { target: { value: '2' } });
        confirm();

        const saved = onSave.mock.calls[0][0];
        expect(saved.totalCost).toBe(3 * 500 + 2 * 400);
        expect(saved.count).toBe(5);
    });
});

describe('DetailSheet labour — the CONTRACT tab does not invent a quantity', () => {
    afterEach(() => cleanup());

    it('with no plot baseline to derive from, contractQuantity is absent — not 0 acres', () => {
        const { onSave } = renderFreshLabourSheet(undefined);

        fireEvent.click(screen.getByText('Contract'));
        confirm();

        const saved = onSave.mock.calls[0][0];
        expect(saved.type).toBe('CONTRACT');
        expect(saved.contractUnit).toBe('Acre');
        expect(saved.contractQuantity).toBeUndefined();
        expect(saved.totalCost).toBeUndefined();
        expect(JSON.stringify(saved)).not.toContain('contractQuantity');
    });

    it('but a quantity the plot CAN supply is still offered as a starting figure', () => {
        // A derived acreage is a real figure the farmer sees in the box and can
        // overwrite. Only the undeterminable case becomes absence.
        const { onSave } = renderFreshLabourSheet({ baseline: { totalArea: 2.5 } } as unknown as Plot);

        fireEvent.click(screen.getByText('Contract'));
        confirm();

        expect(onSave.mock.calls[0][0].contractQuantity).toBe(2.5);
    });
});
