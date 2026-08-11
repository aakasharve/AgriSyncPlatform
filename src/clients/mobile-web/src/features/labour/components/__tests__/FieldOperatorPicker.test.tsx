// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FieldOperatorPicker tests — Labour V1 Task 13 (spec:
 * 2026-07-13-labour-attendance-approval-design).
 *
 * Three contracts, in descending order of how much damage breaking them does:
 *
 *   13.3 — P9, THE SACRED ONE. A headcount-only log ("आज ८ मजूर होते")
 *          renders NO identity prompt of any kind. Asserted structurally
 *          (no warning role, no urgency colour, no number anywhere on the
 *          opt-in) and behaviourally (the roster is not even fetched), so
 *          the block fires the moment anyone adds a nudge.
 *   13.2 — two people may share a name BY DESIGN. Never merged, never
 *          auto-picked: disambiguated by full name where that works, made
 *          visible where it does not, and the tap attaches the id of the row
 *          that was actually tapped.
 *   13.1b — attaching shows, on this engagement, that it now carries बाळू,
 *          and a repeat attach (`alreadyAttached`) is a success, not an error.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ---------------------------------------------------------------------------
// The Field Operator API surface is mocked at the CLIENT module (its own
// transport contract is locked by fieldOperatorClient.test.ts) — these tests
// are about what the farmer sees and which ids leave the UI.
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
const mockCreate = vi.fn();
const mockAttach = vi.fn();
vi.mock('../../data/fieldOperatorClient', () => ({
    fetchFieldOperators: (...args: unknown[]) => mockFetch(...args),
    createFieldOperator: (...args: unknown[]) => mockCreate(...args),
    attachFieldOperator: (...args: unknown[]) => mockAttach(...args),
}));

// ReviewSheet's approve path reaches the real sync queue — stubbed so the
// P9 test can render the HOST without touching Dexie.
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: vi.fn().mockResolvedValue('id') },
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn().mockResolvedValue(undefined) },
}));

import FieldOperatorPicker, { buildPickerRows, shortOperatorTag } from '../FieldOperatorPicker';
import ReviewSheet from '../ReviewSheet';
import { EMPTY_LABOUR_DATA } from '../../labourMock';
import type { LabourData } from '../../labourMock';
import type { DailyLog } from '../../../../types';
import type { FieldOperator } from '../../data/fieldOperatorClient';

const FARM_ID = 'farm-1';
const ASSIGNMENT_ID = 'aa000000-0000-4000-8000-000000000009';

const BALU_SHINDE: FieldOperator = { id: 'a1b2c3d4-1111', displayName: 'बाळू', fullName: 'बाळू शिंदे', isActive: true };
const BALU_NO_FULL: FieldOperator = { id: 'e5f6a7b8-2222', displayName: 'बाळू', isActive: true };
const BALU_ALSO_NO_FULL: FieldOperator = { id: '99887766-3333', displayName: 'बाळू', isActive: true };
const GANESH: FieldOperator = { id: '11223344-4444', displayName: 'गणेश', isActive: true };

const renderPicker = (onToast = vi.fn()) =>
    render(<FieldOperatorPicker farmId={FARM_ID} labourAssignmentId={ASSIGNMENT_ID} onToast={onToast} />);

/** Opens the picker and waits for the roster fetch to settle. */
const openPicker = async () => {
    fireEvent.click(screen.getByTestId('fo-picker-trigger'));
    await waitFor(() => expect(screen.getByTestId('fo-picker-panel')).toBeInTheDocument());
};

beforeEach(() => {
    mockFetch.mockReset().mockResolvedValue([]);
    mockCreate.mockReset();
    mockAttach.mockReset().mockResolvedValue({
        fieldOperatorId: BALU_SHINDE.id,
        labourAssignmentId: ASSIGNMENT_ID,
        alreadyAttached: false,
    });
});
afterEach(() => cleanup());

// ===========================================================================
// 13.3 — P9: a headcount-only log gets NO identity prompt of any kind.
// ===========================================================================

describe('Task 13.3 — headcount-only logging is untouched (P9, Scenario 1)', () => {
    const LOG_ID = 'bbbbbbbb-0000-4000-8000-000000000001';

    /** "आज ८ मजूर होते" — a headcount and nothing else. */
    const headcountOnlyData = (): LabourData => ({
        ...EMPTY_LABOUR_DATA,
        review: [{
            id: LOG_ID,
            who: 'रमेश',
            initial: 'र',
            tone: 'or',
            detail: '2026-08-11',
            status: 'Confirmed',
            points: { count: 8 },
        }],
    });

    /** The same log on the device — it DOES carry an engagement id, so the
     *  picker is eligible here. That is the point: eligibility must not
     *  produce a prompt. */
    const headcountOnlyHistory = (): DailyLog[] => ([{
        id: LOG_ID,
        labour: [{ labourAssignmentId: ASSIGNMENT_ID, count: 8 }],
    } as unknown as DailyLog]);

    const renderHost = () => render(
        <ReviewSheet
            open
            data={headcountOnlyData()}
            onClose={vi.fn()}
            onToast={vi.fn()}
            farmId={FARM_ID}
            history={headcountOnlyHistory()}
        />,
    );

    it('renders the headcount exactly as reported, and attribution never restates it', () => {
        renderHost();

        // ८ मजूर — the farmer's own number, unchanged and unqualified.
        expect(screen.getByText('८ मजूर')).toBeInTheDocument();

        const card = screen.getByTestId(`review-card-${LOG_ID}`);
        // No "0/8", no "८ पैकी ०", no percentage — nothing that turns an
        // optional overlay into a completion target.
        expect(card.textContent).not.toMatch(/\d\s*\/\s*\d/);
        expect(card.textContent).not.toMatch(/[०-९]\s*\/\s*[०-९]/);
        expect(card.textContent).not.toMatch(/%|पैकी|टक्के/);
    });

    it('renders NO identity nag: no unidentified count, no warning, no completion language', () => {
        renderHost();
        const card = screen.getByTestId(`review-card-${LOG_ID}`);

        [/अनोळखी/, /ओळख पटली/, /ओळख नाही/, /अपूर्ण/, /बाकीच्या/, /राहिले/, /नाव नाही/, /नावं टाका/]
            .forEach((nag) => expect(card.textContent).not.toMatch(nag));
    });

    it('sounds no alarm: no role="alert", no aria-live, no amber/rose/red urgency colour on the card', () => {
        renderHost();
        const card = screen.getByTestId(`review-card-${LOG_ID}`);

        expect(card.querySelector('[role="alert"]')).toBeNull();
        expect(card.querySelector('[aria-live]')).toBeNull();
        // The "amber hint" the founder named explicitly. The ONLY warm colour
        // allowed on this card is the author's own Avatar tone (रमेश → 'or'),
        // which is a person-identity token chosen by the read-model, not an
        // urgency signal — everything else must be emerald/stone.
        const warmlyColoured = [...card.querySelectorAll('[class*="amber"], [class*="rose"], [class*="red-"], [class*="orange"], [class*="yellow"]')]
            .filter((el) => el.textContent?.trim() !== 'र');
        expect(warmlyColoured).toHaveLength(0);
    });

    it('shows ONE quiet opt-in and nothing else — the picker itself is not rendered until the farmer asks', () => {
        renderHost();

        const trigger = screen.getByTestId('fo-picker-trigger');
        // Any nag needs a number ("5 workers unidentified", "0/8", "37%").
        // This control has none, in either digit system.
        expect(trigger.textContent).not.toMatch(/[0-9०-९]/);
        expect(trigger.textContent).toContain('ऐच्छिक');

        // Nothing of the picker proper exists yet: no panel, no roster rows,
        // no text field, no already-attached strip.
        expect(screen.queryByTestId('fo-picker-panel')).toBeNull();
        expect(screen.queryByTestId('fo-picker-attached')).toBeNull();
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('does not even LOOK for identities — the roster is never fetched for a headcount-only log', () => {
        renderHost();

        // The strongest form of "no nag": a nudge (a count of unidentified
        // people, a suggestion list, a progress ring) cannot be rendered
        // without this call, so its absence forecloses the whole class.
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('offers no picker at all when the log carries no unique engagement — silence, still not a prompt', () => {
        render(
            <ReviewSheet
                open
                data={headcountOnlyData()}
                onClose={vi.fn()}
                onToast={vi.fn()}
                farmId={FARM_ID}
                history={[{ id: LOG_ID, labour: [] } as unknown as DailyLog]}
            />,
        );

        expect(screen.queryByTestId('fo-picker')).toBeNull();
        expect(screen.getByText('८ मजूर')).toBeInTheDocument();
        expect(mockFetch).not.toHaveBeenCalled();
    });
});

// ===========================================================================
// 13.2 — identical names are two real people.
// ===========================================================================

describe('Task 13.2 — duplicate names stay distinguishable, never merged', () => {
    it('buildPickerRows resolves a collision by full name when that actually separates them', () => {
        const rows = buildPickerRows([BALU_SHINDE, BALU_NO_FULL]);

        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ fullName: 'बाळू शिंदे', ambiguous: false, tag: undefined });
        // The one with no full name is NOT resolved by the other's — it is
        // still an unexplained collision and must say so.
        expect(rows[1].ambiguous).toBe(true);
        expect(rows[1].tag).toBe(shortOperatorTag(BALU_NO_FULL.id));
    });

    it('buildPickerRows marks BOTH rows ambiguous when two people share a name and neither has a full name', () => {
        const rows = buildPickerRows([BALU_NO_FULL, BALU_ALSO_NO_FULL]);

        expect(rows.every((r) => r.ambiguous)).toBe(true);
        expect(rows[0].tag).not.toBe(rows[1].tag);
    });

    it('buildPickerRows keeps BOTH rows ambiguous when they share a name AND a full name (B2 permits it)', () => {
        const twin = { ...BALU_SHINDE, id: 'cccc-9999' };
        const rows = buildPickerRows([BALU_SHINDE, twin]);

        expect(rows.every((r) => r.ambiguous)).toBe(true);
        expect(rows.every((r) => r.fullName === 'बाळू शिंदे')).toBe(true);
        expect(rows[0].tag).not.toBe(rows[1].tag);
    });

    it('leaves a unique name completely unmarked — no tag, no collision note', () => {
        const rows = buildPickerRows([GANESH, BALU_SHINDE]);
        expect(rows[0].ambiguous).toBe(false);
        expect(rows[0].tag).toBeUndefined();
    });

    it('renders every same-named person as its own row, with the collision spelled out on screen', async () => {
        mockFetch.mockResolvedValue([BALU_SHINDE, BALU_NO_FULL, BALU_ALSO_NO_FULL]);
        renderPicker();
        await openPicker();

        await waitFor(() => expect(screen.getByTestId(`fo-row-${BALU_SHINDE.id}`)).toBeInTheDocument());

        // Three बाळू, three rows — none merged away.
        expect(screen.getAllByText('बाळू')).toHaveLength(3);
        expect(screen.getByText('बाळू शिंदे')).toBeInTheDocument();
        // The two with nothing but a name say so, and carry distinct tags.
        expect(screen.getAllByText('सारखं नाव — वेगळी व्यक्ती')).toHaveLength(2);
        expect(screen.getByTestId(`fo-tag-${BALU_NO_FULL.id}`).textContent)
            .not.toBe(screen.getByTestId(`fo-tag-${BALU_ALSO_NO_FULL.id}`).textContent);
    });

    it('attaches the id of the row that was tapped — never the first same-named match', async () => {
        mockFetch.mockResolvedValue([BALU_NO_FULL, BALU_ALSO_NO_FULL]);
        mockAttach.mockResolvedValue({ fieldOperatorId: BALU_ALSO_NO_FULL.id, labourAssignmentId: ASSIGNMENT_ID, alreadyAttached: false });
        renderPicker();
        await openPicker();

        fireEvent.click(await screen.findByTestId(`fo-row-${BALU_ALSO_NO_FULL.id}`));

        await waitFor(() => expect(mockAttach).toHaveBeenCalledTimes(1));
        expect(mockAttach).toHaveBeenCalledWith(FARM_ID, BALU_ALSO_NO_FULL.id, ASSIGNMENT_ID);
    });
});

// ===========================================================================
// 13.1 / 13.1b — select, add, and see what this engagement now carries.
// ===========================================================================

describe('Task 13.1 — select an existing person', () => {
    it('fetches the roster on FIRST open only, not on render and not again on re-open', async () => {
        mockFetch.mockResolvedValue([GANESH]);
        renderPicker();
        expect(mockFetch).not.toHaveBeenCalled();

        await openPicker();
        await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(FARM_ID));

        fireEvent.click(screen.getByTestId('fo-picker-close'));
        fireEvent.click(screen.getByTestId('fo-picker-trigger'));
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not offer a deactivated identity for new work', async () => {
        mockFetch.mockResolvedValue([GANESH, { ...BALU_SHINDE, isActive: false }]);
        renderPicker();
        await openPicker();

        await waitFor(() => expect(screen.getByTestId(`fo-row-${GANESH.id}`)).toBeInTheDocument());
        expect(screen.queryByTestId(`fo-row-${BALU_SHINDE.id}`)).toBeNull();
    });

    it('shows an honest load failure with a retry — never an empty roster the farmer would re-type into', async () => {
        mockFetch.mockRejectedValueOnce(new Error('offline'));
        renderPicker();
        await openPicker();

        expect(await screen.findByText('माहिती आणता आली नाही')).toBeInTheDocument();
        expect(screen.queryByText('अजून कुणाचं नाव नाही')).toBeNull();

        mockFetch.mockResolvedValueOnce([GANESH]);
        fireEvent.click(screen.getByText('पुन्हा प्रयत्न करा'));
        expect(await screen.findByTestId(`fo-row-${GANESH.id}`)).toBeInTheDocument();
    });

    it('shows the honest empty state when the farm genuinely has no one yet', async () => {
        mockFetch.mockResolvedValue([]);
        renderPicker();
        await openPicker();

        expect(await screen.findByText('अजून कुणाचं नाव नाही')).toBeInTheDocument();
    });
});

describe('Task 13.1 — add a person', () => {
    it('creates the person and attaches them in one gesture', async () => {
        mockFetch.mockResolvedValue([]);
        mockCreate.mockResolvedValue(BALU_NO_FULL);
        const onToast = vi.fn();
        renderPicker(onToast);
        await openPicker();

        fireEvent.change(screen.getByTestId('fo-new-name'), { target: { value: '  बाळू  ' } });
        fireEvent.click(screen.getByTestId('fo-add'));

        await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(FARM_ID, 'बाळू'));
        await waitFor(() => expect(mockAttach).toHaveBeenCalledWith(FARM_ID, BALU_NO_FULL.id, ASSIGNMENT_ID));
        await waitFor(() => expect(onToast).toHaveBeenCalledWith('बाळू ✓ जोडलं'));
    });

    it('never posts an empty name', async () => {
        mockFetch.mockResolvedValue([]);
        renderPicker();
        await openPicker();

        fireEvent.change(screen.getByTestId('fo-new-name'), { target: { value: '   ' } });
        fireEvent.click(screen.getByTestId('fo-add'));

        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('tells the truth when the person was created but the attach failed — both facts, not one', async () => {
        mockFetch.mockResolvedValue([]);
        mockCreate.mockResolvedValue(BALU_NO_FULL);
        mockAttach.mockRejectedValue(new Error('500'));
        const onToast = vi.fn();
        renderPicker(onToast);
        await openPicker();

        fireEvent.change(screen.getByTestId('fo-new-name'), { target: { value: 'बाळू' } });
        fireEvent.click(screen.getByTestId('fo-add'));

        await waitFor(() => expect(onToast).toHaveBeenCalledWith(
            'बाळू ची नोंद झाली, पण या कामाला लावता आलं नाही — पुन्हा प्रयत्न करा',
        ));
        // The person still exists, so the row is there to retry against.
        expect(screen.getByTestId(`fo-row-${BALU_NO_FULL.id}`)).toBeInTheDocument();
        expect(screen.queryByTestId('fo-picker-attached')).toBeNull();
    });
});

describe('Task 13.1b — the engagement visibly carries the person afterwards', () => {
    it('shows the attached person on this engagement and disables their row, so they cannot be added twice by accident', async () => {
        mockFetch.mockResolvedValue([BALU_SHINDE, GANESH]);
        renderPicker();
        await openPicker();

        fireEvent.click(await screen.findByTestId(`fo-row-${BALU_SHINDE.id}`));

        expect(await screen.findByTestId(`fo-attached-${BALU_SHINDE.id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`fo-row-${BALU_SHINDE.id}`)).toBeDisabled();
        // The others stay tappable — one attach is not a completed task.
        expect(screen.getByTestId(`fo-row-${GANESH.id}`)).not.toBeDisabled();
    });

    it('keeps the confirmation visible after the panel is closed', async () => {
        mockFetch.mockResolvedValue([BALU_SHINDE]);
        renderPicker();
        await openPicker();

        fireEvent.click(await screen.findByTestId(`fo-row-${BALU_SHINDE.id}`));
        await screen.findByTestId(`fo-attached-${BALU_SHINDE.id}`);
        fireEvent.click(screen.getByTestId('fo-picker-close'));

        expect(screen.getByTestId(`fo-attached-${BALU_SHINDE.id}`)).toBeInTheDocument();
        expect(screen.getByTestId('fo-picker-trigger').textContent).toContain('आणखी नाव जोडा');
    });

    it('treats a repeat attach (alreadyAttached) as success, not failure', async () => {
        mockFetch.mockResolvedValue([BALU_SHINDE]);
        mockAttach.mockResolvedValue({ fieldOperatorId: BALU_SHINDE.id, labourAssignmentId: ASSIGNMENT_ID, alreadyAttached: true });
        const onToast = vi.fn();
        renderPicker(onToast);
        await openPicker();

        fireEvent.click(await screen.findByTestId(`fo-row-${BALU_SHINDE.id}`));

        await waitFor(() => expect(onToast).toHaveBeenCalledWith('बाळू आधीच जोडलेला आहे'));
        expect(await screen.findByTestId(`fo-attached-${BALU_SHINDE.id}`)).toBeInTheDocument();
    });

    it('reports a failed attach honestly and shows nothing as attached', async () => {
        mockFetch.mockResolvedValue([BALU_SHINDE]);
        mockAttach.mockRejectedValue(new Error('network'));
        const onToast = vi.fn();
        renderPicker(onToast);
        await openPicker();

        fireEvent.click(await screen.findByTestId(`fo-row-${BALU_SHINDE.id}`));

        await waitFor(() => expect(onToast).toHaveBeenCalledWith('जोडता आलं नाही — पुन्हा प्रयत्न करा'));
        expect(screen.queryByTestId('fo-picker-attached')).toBeNull();
    });
});
