// @vitest-environment jsdom
/**
 * spec: plr-d10 I26 (founder D-34, PLR-D10 L3b) — "या N जणांमध्ये कोण होते?"
 * asked PER WORK under each तपासा card.
 *
 * What these pin, in the founder's terms:
 *  - the count on the card is never changed by naming people (P7);
 *  - fewer names than N leaves the rest anonymous, and says so truthfully;
 *  - more names than N is impossible here and refused with a plain reason;
 *  - one person may be named on two works of the same day, offered first on
 *    the second work because the system remembers the PERSON — it never
 *    assumes the WORK;
 *  - हजेरी presence is a suggestion only: it orders and labels, never links;
 *  - a headcount-only card still shows no number on its quiet opt-in (P9).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockFetch = vi.fn();
const mockCreate = vi.fn();
const mockAttach = vi.fn();
vi.mock('../../data/fieldOperatorClient', () => ({
    fetchFieldOperators: (...args: unknown[]) => mockFetch(...args),
    createFieldOperator: (...args: unknown[]) => mockCreate(...args),
    attachFieldOperator: (...args: unknown[]) => mockAttach(...args),
}));
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: vi.fn().mockResolvedValue('id') },
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn().mockResolvedValue(undefined) },
}));

import ReviewSheet from '../ReviewSheet';
import { EMPTY_LABOUR_DATA } from '../../labourMock';
import type { LabourData, ReviewItem } from '../../labourMock';
import type { LedgerRow } from '../../labour.types';
import type { DailyLog } from '../../../../types';
import type { FieldOperator } from '../../data/fieldOperatorClient';

const FARM_ID = 'farm-1';
const DAY = '2026-10-27';
const GANESH: FieldOperator = { id: 'op-ganesh', displayName: 'गणेश', isActive: true };
const RAMESH: FieldOperator = { id: 'op-ramesh', displayName: 'रमेश', isActive: true };
const SUNIL: FieldOperator = { id: 'op-sunil', displayName: 'सुनील', isActive: true };
const VILAS: FieldOperator = { id: 'op-vilas', displayName: 'विलास', isActive: true };

const reviewItem = (id: string, count: number): ReviewItem => ({
    id, who: 'मालक', initial: 'म', tone: 'em', detail: DAY, status: 'Confirmed', points: { count },
});
const workLog = (id: string, assignmentId: string, count: number, attributed: FieldOperator[] = []): DailyLog => ({
    id,
    date: DAY,
    labour: [{
        labourAssignmentId: assignmentId,
        count,
        attributedOperators: attributed.map((o) => ({ fieldOperatorId: o.id, displayNameAtAttach: o.displayName })),
    }],
} as unknown as DailyLog);

const presentRow = (op: FieldOperator): LedgerRow => ({
    personId: `op:${op.id}`, fieldOperatorId: op.id, name: op.displayName, initial: op.displayName.slice(0, 1), tone: 'em',
    cells: [{ day: 'full', night: null, hours: null, extraHours: null, ukte: false, work: null }],
});

function renderSheet(items: ReviewItem[], history: DailyLog[], ledgerRows: LedgerRow[] = [], onToast = vi.fn()) {
    const data: LabourData = {
        ...EMPTY_LABOUR_DATA,
        review: items,
        ledger: { weekLabel: '', days: [DAY], rows: ledgerRows, crewRows: [] },
    };
    render(<ReviewSheet open data={data} onClose={vi.fn()} onToast={onToast} farmId={FARM_ID} history={history} />);
    return onToast;
}

const work = (assignmentId: string) => screen.getByTestId(`work-attribution-${assignmentId}`);

async function openWork(assignmentId: string) {
    fireEvent.click(within(work(assignmentId)).getByTestId('fo-picker-trigger'));
    await waitFor(() => expect(within(work(assignmentId)).getByTestId('fo-picker-panel')).toBeInTheDocument());
    await waitFor(() => expect(within(work(assignmentId)).queryByText('नावांची यादी येत आहे…')).toBeNull());
}

beforeEach(() => {
    mockFetch.mockReset().mockResolvedValue([GANESH, RAMESH, SUNIL, VILAS]);
    mockCreate.mockReset();
    mockAttach.mockReset().mockImplementation((_farm: string, operatorId: string, assignmentId: string) =>
        Promise.resolve({ fieldOperatorId: operatorId, labourAssignmentId: assignmentId, alreadyAttached: false }));
});
afterEach(() => cleanup());

describe('D-34 — the per-work question', () => {
    it('keeps the closed opt-in number-free (P9) and asks the founder\'s question once opened', async () => {
        renderSheet([reviewItem('L1', 6)], [workLog('L1', 'A1', 6)]);

        const trigger = within(work('A1')).getByTestId('fo-picker-trigger');
        expect(trigger.textContent).not.toMatch(/[0-9०-९]/);
        expect(screen.queryByText('या ६ जणांमध्ये कोण होते?')).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();

        await openWork('A1');
        expect(within(work('A1')).getByText('या ६ जणांमध्ये कोण होते?')).toBeInTheDocument();
    });

    it('shows who the server says is named and how many stay anonymous — the count stays ६', () => {
        renderSheet([reviewItem('L1', 6)], [workLog('L1', 'A1', 6, [GANESH, RAMESH, SUNIL])]);

        const block = work('A1');
        expect(within(block).getByTestId(`fo-attached-${GANESH.id}`)).toHaveTextContent('गणेश');
        expect(within(block).getByTestId('fo-picker-readout')).toHaveTextContent('३ जणांची नावं · ३ अनामिक');
        expect(screen.getByText('६ जण')).toBeInTheDocument();
    });
});

describe('D-34 — never more names than the work states', () => {
    it('makes a third name on a two-person work impossible, with a plain reason, and attaches nothing', async () => {
        renderSheet([reviewItem('L1', 2)], [workLog('L1', 'A1', 2, [GANESH, RAMESH])]);
        // A full work's closed control promises only what it can do: see the names, not add one.
        expect(within(work('A1')).getByTestId('fo-picker-trigger')).toHaveTextContent('नावं पाहा');
        await openWork('A1');

        const block = work('A1');
        expect(within(block).getByTestId('fo-picker-readout')).toHaveTextContent('सगळ्या २ जणांची नावं');
        expect(within(block).getByTestId('fo-picker-full')).toHaveTextContent('या कामात २ जण होते — यापेक्षा जास्त नावं जोडता येत नाहीत.');
        const sunilRow = within(block).getByTestId(`fo-row-${SUNIL.id}`);
        expect(sunilRow).toBeDisabled();
        fireEvent.click(sunilRow);
        expect(within(block).getByTestId('fo-add')).toBeDisabled();
        expect(mockAttach).not.toHaveBeenCalled();
        expect(screen.getByText('२ जण')).toBeInTheDocument();
    });

    it('turns the server\'s refusal into the same plain reason, never a "try again"', async () => {
        mockAttach.mockReset().mockRejectedValue({ response: { status: 409, data: { error: 'ShramSafal.Attribution.ExceedsHeadcount' } } });
        const onToast = renderSheet([reviewItem('L1', 6)], [workLog('L1', 'A1', 6)]);
        await openWork('A1');

        fireEvent.click(within(work('A1')).getByTestId(`fo-row-${GANESH.id}`));

        await waitFor(() => expect(onToast).toHaveBeenCalledWith('या कामात ६ जण होते — यापेक्षा जास्त नावं जोडता येत नाहीत.'));
        expect(onToast).not.toHaveBeenCalledWith('जोडता आलं नाही — पुन्हा प्रयत्न करा');
    });
});

describe('D-34 — one person, two works, same day', () => {
    it('offers Ganesh first on the second work, unlinked, and links him only when tapped there', async () => {
        renderSheet(
            [reviewItem('L1', 6), reviewItem('L2', 4)],
            [workLog('L1', 'A1', 6), workLog('L2', 'A2', 4)],
        );

        await openWork('A1');
        fireEvent.click(within(work('A1')).getByTestId(`fo-row-${GANESH.id}`));
        await waitFor(() => expect(within(work('A1')).getByTestId(`fo-attached-${GANESH.id}`)).toBeInTheDocument());
        expect(mockAttach).toHaveBeenCalledTimes(1);
        expect(mockAttach).toHaveBeenLastCalledWith(FARM_ID, GANESH.id, 'A1');

        await openWork('A2');
        const rows = [...work('A2').querySelectorAll('[data-testid^="fo-row-"]')].map((el) => el.getAttribute('data-testid'));
        expect(rows[0]).toBe(`fo-row-${GANESH.id}`);
        expect(within(work('A2')).getByTestId(`fo-row-${GANESH.id}`)).toHaveTextContent('त्याच दिवशी दुसऱ्या कामात');
        expect(within(work('A2')).queryByTestId(`fo-attached-${GANESH.id}`)).toBeNull();
        expect(mockAttach).toHaveBeenCalledTimes(1);

        fireEvent.click(within(work('A2')).getByTestId(`fo-row-${GANESH.id}`));
        await waitFor(() => expect(within(work('A2')).getByTestId(`fo-attached-${GANESH.id}`)).toBeInTheDocument());
        expect(mockAttach).toHaveBeenLastCalledWith(FARM_ID, GANESH.id, 'A2');
        expect(screen.getByText('६ जण')).toBeInTheDocument();
        expect(screen.getByText('४ जण')).toBeInTheDocument();
    });

    it('suggests a person present in हजेरी that day, but never links him from presence', async () => {
        renderSheet([reviewItem('L1', 6)], [workLog('L1', 'A1', 6)], [presentRow(VILAS)]);
        await openWork('A1');

        const rows = [...work('A1').querySelectorAll('[data-testid^="fo-row-"]')].map((el) => el.getAttribute('data-testid'));
        expect(rows[0]).toBe(`fo-row-${VILAS.id}`);
        expect(within(work('A1')).getByTestId(`fo-row-${VILAS.id}`)).toHaveTextContent('त्याच दिवशी हजेरीत');
        expect(within(work('A1')).queryByTestId('fo-picker-attached')).toBeNull();
        expect(mockAttach).not.toHaveBeenCalled();
    });

    it('asks per work on one log that carries two works the farmer can tell apart', () => {
        const twoWorks = {
            id: 'L1', date: DAY,
            labour: [
                { labourAssignmentId: 'A1', count: 6, targetPlotName: 'प्लॉट १' },
                { labourAssignmentId: 'A2', count: 4, targetPlotName: 'प्लॉट २' },
            ],
        } as unknown as DailyLog;
        renderSheet([reviewItem('L1', 10)], [twoWorks]);

        expect(within(work('A1')).getByText('प्लॉट १')).toBeInTheDocument();
        expect(within(work('A2')).getByText('प्लॉट २')).toBeInTheDocument();
    });
});
