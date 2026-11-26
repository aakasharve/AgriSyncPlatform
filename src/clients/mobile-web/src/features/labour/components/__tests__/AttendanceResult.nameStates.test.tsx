// @vitest-environment jsdom
/**
 * Repair FIX-1 item 6 (R2-B 19-B, founder 27 Nov). On the हजेरी confirm card every spoken name shows its state BEFORE "बरोबर":
 *   - on the list, one person: "यादीत आहे";
 *   - not on the list: amber "यादीत नाही" with "यादीतून निवडा" (the farm's list) and "नवीन नाव जोडा" (the existing add);
 *   - two people with that name: "सारखं नाव — कोण?", which opens the list that tells them apart.
 * One line above "बरोबर" when any name will get no mark: "N नावांची हजेरी लागली नाही". Nothing is silent.
 * "बरोबर" still works and writes exactly the marks it writes today (never a guess: rule 10); the head count never changes (P7).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AttendanceResult from '../AttendanceResult';
import type { AgriLogResponse } from '../../../../types';

const h = vi.hoisted(() => ({
    enqueue: vi.fn(async (_payload: unknown) => 'client-request-id'),
    fetchOperators: vi.fn(async (_farmId: string): Promise<unknown[]> => []),
    createOperator: vi.fn(async (_farmId: string, displayName: string, fullName?: string) => ({ id: 'op-new', displayName, fullName: fullName ?? null, isActive: true })),
    language: 'mr' as 'mr' | 'en',
}));
vi.mock('../../../../application/usecases/sync/MarkAttendanceCommand', () => ({
    MarkAttendanceCommand: { enqueue: (payload: unknown) => h.enqueue(payload) },
}));
vi.mock('../../data/fieldOperatorClient', () => ({
    fetchFieldOperators: (farmId: string) => h.fetchOperators(farmId),
    createFieldOperator: (farmId: string, name: string, fullName?: string) => h.createOperator(farmId, name, fullName),
}));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: h.language }),
}));

const FARM = '22222222-2222-2222-2222-222222222222';
const base: AgriLogResponse = {
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [],
    labour: [], inputs: [], machinery: [], activityExpenses: [], missingSegments: [],
};
const anchor = { state: 'anchored', headcount: 3, logId: 'log-1' } as const;
const ROSTER = [
    { id: 'op-ganesh', displayName: 'गणेश', isActive: true },
    { id: 'op-balu-1', displayName: 'बाळू', fullName: 'बाळू पवार', isActive: true },
    { id: 'op-balu-2', displayName: 'बाळू', fullName: 'बाळू जाधव', isActive: true },
];
const labour = [{ id: 'l1', type: 'hired', count: 3, workerNames: ['गणेश', 'राजू', 'बाळू'] }] as unknown as AgriLogResponse['labour'];

async function draw() {
    h.fetchOperators.mockResolvedValueOnce(ROSTER);
    const onConfirm = vi.fn();
    render(<AttendanceResult draft={{ ...base, labour }} anchor={anchor} farmId={FARM} onConfirm={onConfirm} onSpeakMore={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('attendance-name-गणेश')).toHaveTextContent('यादीत आहे'));
    return onConfirm;
}
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'बरोबर' }));
const markedIds = () => h.enqueue.mock.calls.map(c => (c[0] as { fieldOperatorId: string }).fieldOperatorId);

beforeEach(() => { h.enqueue.mockClear(); h.fetchOperators.mockReset(); h.createOperator.mockClear(); h.language = 'mr'; });
afterEach(cleanup);

describe('हजेरी confirm card — every spoken name says where it stands', () => {
    it('three names: on the list, not on the list, shared — each says so, and one line counts the unmarked', async () => {
        const onConfirm = await draw();
        expect(screen.getByTestId('attendance-name-गणेश')).toHaveTextContent('यादीत आहे');

        const raju = screen.getByTestId('attendance-name-राजू');
        expect(raju).toHaveTextContent('यादीत नाही');
        expect(raju.className).toContain('amber');
        expect(within(raju).getByRole('button', { name: 'यादीतून निवडा' })).toBeInTheDocument();
        expect(within(raju).getByRole('button', { name: 'नवीन नाव जोडा' })).toBeInTheDocument();

        expect(within(screen.getByTestId('attendance-name-बाळू')).getByRole('button', { name: 'सारखं नाव — कोण?' })).toBeInTheDocument();

        // Marathi digits, the founder's words exactly
        expect(screen.getByTestId('attendance-unmarked-line')).toHaveTextContent('२ नावांची हजेरी लागली नाही');

        // बरोबर still writes exactly today's marks: गणेश only; the count he said is untouched
        confirm();
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect((onConfirm.mock.calls[0][0] as AgriLogResponse).labour[0].count).toBe(3);
        expect(markedIds()).toEqual(['op-ganesh']);
    });

    it('"सारखं नाव — कोण?" opens the list that tells the two apart; the one he picks gets the mark', async () => {
        await draw();
        fireEvent.click(screen.getByRole('button', { name: 'सारखं नाव — कोण?' }));
        const list = screen.getByTestId('attendance-pick-list');
        expect(within(list).getByText('बाळू पवार')).toBeInTheDocument();
        expect(within(list).getByText('बाळू जाधव')).toBeInTheDocument();
        expect(within(list).queryByText('गणेश')).toBeNull();
        fireEvent.click(within(list).getByTestId('attendance-pick-op-balu-2'));
        expect(screen.queryByTestId('attendance-pick-list')).toBeNull();
        expect(screen.getByTestId('attendance-name-बाळू')).toHaveTextContent('यादीत आहे');
        expect(screen.getByTestId('attendance-unmarked-line')).toHaveTextContent('१ नावांची हजेरी लागली नाही');
        confirm();
        expect(markedIds().sort()).toEqual(['op-balu-2', 'op-ganesh']);
    });

    it('"यादीतून निवडा" opens the farm\'s list; the person he picks gets the mark for the spoken name', async () => {
        await draw();
        fireEvent.click(within(screen.getByTestId('attendance-name-राजू')).getByRole('button', { name: 'यादीतून निवडा' }));
        const list = screen.getByTestId('attendance-pick-list');
        // गणेश is already on this card (his own name): never offered twice
        expect(within(list).queryByTestId('attendance-pick-op-ganesh')).toBeNull();
        expect(within(list).getByTestId('attendance-pick-op-balu-1')).toBeInTheDocument();
        expect(within(list).getByTestId('attendance-pick-op-balu-2')).toBeInTheDocument();
        fireEvent.click(within(list).getByTestId('attendance-pick-op-balu-1'));
        expect(screen.getByTestId('attendance-name-राजू')).toHaveTextContent('यादीत आहे');
        confirm();
        expect(markedIds().sort()).toEqual(['op-balu-1', 'op-ganesh']);
    });

    it('"नवीन नाव जोडा" adds the person through the existing add (his spoken name filled in), then marks him', async () => {
        await draw();
        fireEvent.click(within(screen.getByTestId('attendance-name-राजू')).getByRole('button', { name: 'नवीन नाव जोडा' }));
        const name = screen.getByTestId('attendance-add-name') as HTMLInputElement;
        expect(name.value).toBe('राजू');
        fireEvent.click(screen.getByTestId('attendance-add-submit'));
        await waitFor(() => expect(screen.getByTestId('attendance-name-राजू')).toHaveTextContent('यादीत आहे'));
        expect(h.createOperator).toHaveBeenCalledWith(FARM, 'राजू', undefined);
        confirm();
        expect(markedIds().sort()).toEqual(['op-ganesh', 'op-new']);
    });

    it('every name on the list: no line; offline (no list): no state is claimed, and the line says no name got a mark', async () => {
        h.fetchOperators.mockResolvedValueOnce([{ id: 'op-ganesh', displayName: 'गणेश', isActive: true }]);
        render(<AttendanceResult draft={{ ...base, labour: [{ id: 'l1', type: 'hired', count: 1, workerNames: ['गणेश'] }] as unknown as AgriLogResponse['labour'] }}
            anchor={anchor} farmId={FARM} onConfirm={vi.fn()} onSpeakMore={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attendance-name-गणेश')).toHaveTextContent('यादीत आहे'));
        expect(screen.queryByTestId('attendance-unmarked-line')).toBeNull();
        cleanup();

        h.fetchOperators.mockRejectedValueOnce(new Error('Network Error'));
        render(<AttendanceResult draft={{ ...base, labour }} anchor={anchor} farmId={FARM} onConfirm={vi.fn()} onSpeakMore={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attendance-unmarked-line')).toHaveTextContent('३ नावांची हजेरी लागली नाही'));
        expect(screen.getByTestId('attendance-names')).not.toHaveTextContent('यादीत');
    });

    it('English mode: the English twins', async () => {
        h.language = 'en';
        h.fetchOperators.mockResolvedValueOnce(ROSTER);
        render(<AttendanceResult draft={{ ...base, labour }} anchor={anchor} farmId={FARM} onConfirm={vi.fn()} onSpeakMore={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attendance-name-गणेश')).toHaveTextContent('On the list'));
        expect(screen.getByTestId('attendance-name-राजू')).toHaveTextContent('Not on the list');
        expect(screen.getByRole('button', { name: 'Choose from the list' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add a new name' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Same name — who?' })).toBeInTheDocument();
        expect(screen.getByTestId('attendance-unmarked-line')).toHaveTextContent('Attendance not marked for 2 names');
    });
});
