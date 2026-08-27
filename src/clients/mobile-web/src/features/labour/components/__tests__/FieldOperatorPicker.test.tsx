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

    /*
     * The तपासणी queue is bounded to the last 14 days
     * (`REVIEW_QUEUE_MAX_AGE_DAYS`, ReviewSheet.tsx:36), so a LITERAL date in this
     * fixture is a fuse, not a constant: the log stops rendering on the day it ages
     * out and every assertion below then passes/fails for a reason that has nothing
     * to do with P9. This block was written on 2026-08-11 carrying
     * `detail: '2026-08-11'` (that day's date) and went red on 2026-08-26 — the
     * first morning it was 15 days old — taking the P9 guard silently offline.
     *
     * The date was never the thing under test; "a headcount-only log that is
     * CURRENTLY in the review queue" is. So the fixture states that directly.
     * The bound itself keeps its own dedicated coverage in
     * reviewApprove.test.ts:313.
     *
     * Built from local date parts, NOT `toISOString()` (UTC), because
     * `parseReviewDetailDate` reads `detail` as a LOCAL `yyyy-MM-dd`
     * (`new Date(detail + 'T00:00:00')`) — the same trap documented at
     * reviewApprove.test.ts:279-282.
     */
    const todayIsoLocal = (): string => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    /** "आज ८ मजूर होते" — a headcount and nothing else. */
    const headcountOnlyData = (): LabourData => ({
        ...EMPTY_LABOUR_DATA,
        review: [{
            id: LOG_ID,
            who: 'रमेश',
            initial: 'र',
            tone: 'or',
            detail: todayIsoLocal(),
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

    /*
     * Fix round 1. The roster arrives ordered by CreatedAtUtc, so two बाळू
     * created weeks apart land far apart in the list and the farmer never
     * sees that there ARE two. A collision the farmer has to scroll to find
     * is not a visible collision.
     */
    it('groups same-named people adjacently, keeping first-appearance order for everyone else', () => {
        const rows = buildPickerRows([BALU_SHINDE, GANESH, BALU_NO_FULL, BALU_ALSO_NO_FULL]);

        expect(rows.map((r) => r.operator.id)).toEqual([
            BALU_SHINDE.id, BALU_NO_FULL.id, BALU_ALSO_NO_FULL.id, GANESH.id,
        ]);
    });

    it('renders the grouped order in the DOM, not the order the server sent', async () => {
        // Server order interleaves them; the picker must not.
        mockFetch.mockResolvedValue([BALU_NO_FULL, GANESH, BALU_ALSO_NO_FULL]);
        renderPicker();
        await openPicker();

        await waitFor(() => expect(screen.getByTestId(`fo-row-${GANESH.id}`)).toBeInTheDocument());
        const rendered = [...screen.getByTestId('fo-picker-panel').querySelectorAll('[data-testid^="fo-row-"]')]
            .map((el) => el.getAttribute('data-testid'));
        expect(rendered).toEqual([
            `fo-row-${BALU_NO_FULL.id}`, `fo-row-${BALU_ALSO_NO_FULL.id}`, `fo-row-${GANESH.id}`,
        ]);
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

    /*
     * Fix round 1. A live "add a person" form under a "could not load the
     * list" banner invites the farmer to re-create someone he already has —
     * the exact mistake the banner exists to prevent.
     */
    it('closes creation while the roster failed to load, and says why', async () => {
        mockFetch.mockRejectedValueOnce(new Error('offline'));
        renderPicker();
        await openPicker();

        await screen.findByText('माहिती आणता आली नाही');
        expect(screen.getByTestId('fo-add-blocked')).toBeInTheDocument();
        expect(screen.getByTestId('fo-new-name')).toBeDisabled();
        expect(screen.getByTestId('fo-new-full-name')).toBeDisabled();
        expect(screen.getByTestId('fo-add')).toBeDisabled();
    });

    it('re-opens creation once the retry succeeds', async () => {
        mockFetch.mockRejectedValueOnce(new Error('offline'));
        renderPicker();
        await openPicker();

        await screen.findByText('माहिती आणता आली नाही');
        mockFetch.mockResolvedValueOnce([GANESH]);
        fireEvent.click(screen.getByText('पुन्हा प्रयत्न करा'));

        await screen.findByTestId(`fo-row-${GANESH.id}`);
        expect(screen.queryByTestId('fo-add-blocked')).toBeNull();
        expect(screen.getByTestId('fo-new-name')).not.toBeDisabled();
        expect(screen.getByTestId('fo-new-full-name')).not.toBeDisabled();
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

        await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(FARM_ID, 'बाळू', undefined));
        await waitFor(() => expect(mockAttach).toHaveBeenCalledWith(FARM_ID, BALU_NO_FULL.id, ASSIGNMENT_ID));
        await waitFor(() => expect(onToast).toHaveBeenCalledWith('बाळू ✓ जोडलं'));
    });

    /*
     * Fix round 1. Without this field every operator the app can create has
     * fullName = null (no rename client by design, seeder creates none), so
     * buildPickerRows' resolve-by-full-name branch was unreachable in
     * production and every real collision fell through to a hex fragment.
     */
    it('passes the optional full name / identity through when the farmer supplies one', async () => {
        mockFetch.mockResolvedValue([]);
        mockCreate.mockResolvedValue(BALU_SHINDE);
        renderPicker();
        await openPicker();

        fireEvent.change(screen.getByTestId('fo-new-name'), { target: { value: 'बाळू' } });
        fireEvent.change(screen.getByTestId('fo-new-full-name'), { target: { value: '  बाळू शिंदे  ' } });
        fireEvent.click(screen.getByTestId('fo-add'));

        await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(FARM_ID, 'बाळू', 'बाळू शिंदे'));
    });

    it('keeps the identity field OPTIONAL — a name-only add is enabled and posts no full name (P9)', async () => {
        mockFetch.mockResolvedValue([]);
        mockCreate.mockResolvedValue(BALU_NO_FULL);
        renderPicker();
        await openPicker();

        fireEvent.change(screen.getByTestId('fo-new-name'), { target: { value: 'बाळू' } });
        // The button is live on the name alone — the second field never gates it.
        expect(screen.getByTestId('fo-add')).not.toBeDisabled();
        fireEvent.click(screen.getByTestId('fo-add'));

        await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(FARM_ID, 'बाळू', undefined));
    });

    it('a whitespace-only identity is no identity — not sent', async () => {
        mockFetch.mockResolvedValue([]);
        mockCreate.mockResolvedValue(BALU_NO_FULL);
        renderPicker();
        await openPicker();

        fireEvent.change(screen.getByTestId('fo-new-name'), { target: { value: 'बाळू' } });
        fireEvent.change(screen.getByTestId('fo-new-full-name'), { target: { value: '   ' } });
        fireEvent.click(screen.getByTestId('fo-add'));

        await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(FARM_ID, 'बाळू', undefined));
    });

    it('a full name typed here actually resolves the collision it was typed for (rule 2, end to end)', async () => {
        // One बाळू already exists with no full name; the farmer adds a second
        // and gives him a surname.
        mockFetch.mockResolvedValue([BALU_NO_FULL]);
        mockCreate.mockResolvedValue(BALU_SHINDE);
        renderPicker();
        await openPicker();

        fireEvent.change(screen.getByTestId('fo-new-name'), { target: { value: 'बाळू' } });
        fireEvent.change(screen.getByTestId('fo-new-full-name'), { target: { value: 'बाळू शिंदे' } });
        fireEvent.click(screen.getByTestId('fo-add'));

        // The named one is now told apart BY HIS NAME — no hex tag on him —
        // while the nameless one still carries the honest fallback.
        expect(await screen.findByText('बाळू शिंदे')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByTestId(`fo-tag-${BALU_SHINDE.id}`)).toBeNull());
        expect(screen.getByTestId(`fo-tag-${BALU_NO_FULL.id}`)).toBeInTheDocument();
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

// ===========================================================================
// Phase 6 — instructional examples on an empty roster.
//
// An empty list does not tell a first-time farmer WHAT belongs in it. Three
// faint names do, without a word of instruction. The whole risk of that idea
// is that a name on screen looks like a person in the system, so every test
// below exists to prove the opposite: these are three string literals that
// create nothing, fetch nothing, store nothing and cannot be tapped.
//
// §B6, the binding constraint: demo people are UI EXAMPLES ONLY — zero fake
// `FieldOperator` rows. The plan's acceptance test is a database assertion
// (`SELECT count(*) FROM ssf.field_operators` = 0); its front-end half is
// here, because `createFieldOperator` / `attachFieldOperator` are the ONLY
// two calls in this client that can put a row in that table.
// ===========================================================================

describe('Phase 6 — the empty roster teaches by example, and creates nobody', () => {
    /*
     * The oracle. A deliberate second copy of the literals the component
     * renders, held here rather than imported, so changing a farmer-facing
     * name is a decision someone has to make in two places — the same
     * discipline `translationsSplit.test.ts` applies to Marathi copy. It is
     * also what stops a real person's name, or a nag phrase, being slipped in
     * silently.
     */
    const EXAMPLE_NAMES = ['सुनीता', 'संदीप', 'विलास'];

    /*
     * jsdom ships no IndexedDB, so a spied stand-in is the whole of the
     * device's local storage for the duration of these tests. `open` is the
     * first thing Dexie does — before it can read or write a single row — so
     * zero calls to it is a complete proof that nothing was persisted
     * locally, not a proxy for one.
     */
    const originalIndexedDb = Reflect.get(globalThis, 'indexedDB');
    let idbOpen: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        idbOpen = vi.fn();
        Reflect.set(globalThis, 'indexedDB', { open: idbOpen, deleteDatabase: vi.fn(), databases: vi.fn() });
    });
    afterEach(() => Reflect.set(globalThis, 'indexedDB', originalIndexedDb));

    /** Empty roster, panel open, examples on screen — the state under test. */
    const openOnEmptyRoster = async (onToast = vi.fn()) => {
        mockFetch.mockResolvedValue([]);
        renderPicker(onToast);
        await openPicker();
        return screen.findByTestId('fo-example-names');
    };

    it('shows the example names, and exactly those, once the roster comes back genuinely empty', async () => {
        const examples = await openOnEmptyRoster();

        expect([...examples.children].map((el) => el.textContent)).toEqual(EXAMPLE_NAMES);
        // They sit under the honest heading, which still says there is nobody
        // here — so the screen never claims these three are a roster.
        expect(screen.getByText('अजून कुणाचं नाव नाही')).toBeInTheDocument();
    });

    it('carries NO lead word — just the names (the founder cut "उदा.")', async () => {
        const examples = await openOnEmptyRoster();

        expect(examples.textContent).not.toMatch(/उदा|उदाहरण|e\.g\.|example/i);
        // And nothing numeric crept in with them (P9: no counts anywhere on
        // this optional overlay, in either digit system).
        expect(examples.textContent).not.toMatch(/[0-9०-९]/);
    });

    it('is inert text, not a control: no button, no link, no role, no tab stop, no handler', async () => {
        const examples = await openOnEmptyRoster();

        expect(examples.tagName).toBe('SPAN');
        expect(examples.closest('button')).toBeNull();
        expect(examples.querySelector('button, a, input, [role], [tabindex], [onclick], [href]')).toBeNull();
        [...examples.children].forEach((child) => {
            expect(child.tagName).toBe('SPAN');
            expect(child.hasAttribute('role')).toBe(false);
            expect(child.hasAttribute('tabindex')).toBe(false);
        });
    });

    it('does nothing at all when tapped — no attach, no create, no toast, no selection', async () => {
        const onToast = vi.fn();
        const examples = await openOnEmptyRoster(onToast);

        [...examples.children].forEach((child) => fireEvent.click(child));
        fireEvent.click(examples);

        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockAttach).not.toHaveBeenCalled();
        expect(onToast).not.toHaveBeenCalled();
        expect(screen.queryByTestId('fo-picker-attached')).toBeNull();
    });

    it('mints no Field Operator by existing — the two calls that could write a row are never made', async () => {
        await openOnEmptyRoster();

        // The front-end half of `SELECT count(*) FROM ssf.field_operators` = 0.
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockAttach).not.toHaveBeenCalled();
        // And not one of them is a selectable person: no operator row exists.
        expect(document.querySelectorAll('[data-testid^="fo-row-"]')).toHaveLength(0);
    });

    it('writes nothing to the device — no local database is so much as opened', async () => {
        await openOnEmptyRoster();

        expect(idbOpen).not.toHaveBeenCalled();
    });

    it('is hidden from screen readers — three people who do not exist are never announced', async () => {
        const examples = await openOnEmptyRoster();

        expect(examples).toHaveAttribute('aria-hidden', 'true');
        EXAMPLE_NAMES.forEach((name) => expect(screen.queryByLabelText(name)).toBeNull());
    });

    it('never appears before the farmer opts in — the closed opt-in shows no names (P9)', () => {
        renderPicker();

        expect(screen.queryByTestId('fo-example-names')).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not flash while the roster is still being fetched', async () => {
        let releaseRoster!: (operators: FieldOperator[]) => void;
        mockFetch.mockImplementation(() => new Promise<FieldOperator[]>((resolve) => { releaseRoster = resolve; }));
        renderPicker();
        await openPicker();

        expect(screen.getByText('माणसं आणत आहोत…')).toBeInTheDocument();
        expect(screen.queryByTestId('fo-example-names')).toBeNull();

        releaseRoster([]);
        await waitFor(() => expect(screen.getByTestId('fo-example-names')).toBeInTheDocument());
    });

    it('never appears when the roster failed to load — a failure is not an empty farm', async () => {
        mockFetch.mockRejectedValueOnce(new Error('offline'));
        renderPicker();
        await openPicker();

        await screen.findByText('माहिती आणता आली नाही');
        expect(screen.queryByTestId('fo-example-names')).toBeNull();
        // Nor do the names leak in as loose text beside the error.
        EXAMPLE_NAMES.forEach((name) => expect(screen.queryByText(name)).toBeNull());
    });

    it('is gone the moment a real roster arrives — never sits beside a real person', async () => {
        mockFetch.mockResolvedValue([GANESH]);
        renderPicker();
        await openPicker();

        await screen.findByTestId(`fo-row-${GANESH.id}`);
        expect(screen.queryByTestId('fo-example-names')).toBeNull();
        EXAMPLE_NAMES.forEach((name) => expect(screen.queryByText(name)).toBeNull());
    });

    it('is gone the instant the farmer’s OWN first person lands, with no re-fetch', async () => {
        mockCreate.mockResolvedValue(BALU_NO_FULL);
        await openOnEmptyRoster();

        fireEvent.change(screen.getByTestId('fo-new-name'), { target: { value: 'बाळू' } });
        fireEvent.click(screen.getByTestId('fo-add'));

        await screen.findByTestId(`fo-row-${BALU_NO_FULL.id}`);
        expect(screen.queryByTestId('fo-example-names')).toBeNull();
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
});
