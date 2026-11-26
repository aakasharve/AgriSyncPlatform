// @vitest-environment jsdom
/**
 * Repair FIX-1 item 8 (R2-B 19-E step 1, founder 27 Nov) — "कोणामार्फत?" on the labour line of a NEW work entry (the हजेरी
 * confirm card, before "बरोबर" saves it): a tap opens the farm's people list plus "कोणी नाही" / "माहीत नाही". A person chosen
 * rides the labour line as `engagedThroughFieldOperatorId`; nothing chosen, "कोणी नाही" or "माहीत नाही" = the field is not
 * there (never guessed from the role or from who typed it). The head count never changes (P7). A record already saved cannot
 * be changed this way yet (the server has no door for it), so an edit shows no "कोणामार्फत?".
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
    language: 'mr' as 'mr' | 'en',
}));
vi.mock('../../../../application/usecases/sync/MarkAttendanceCommand', () => ({
    MarkAttendanceCommand: { enqueue: (payload: unknown) => h.enqueue(payload) },
}));
vi.mock('../../data/fieldOperatorClient', () => ({
    fetchFieldOperators: (farmId: string) => h.fetchOperators(farmId),
    createFieldOperator: vi.fn(),
}));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: h.language }),
}));

const FARM = '22222222-2222-2222-2222-222222222222';
const SHANKAR = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const RAMESH = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const base: AgriLogResponse = {
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [],
    labour: [], inputs: [], machinery: [], activityExpenses: [], missingSegments: [],
};
const anchor = { state: 'anchored', headcount: 8, logId: 'log-1' } as const;
const crew = [{ id: 'l1', type: 'hired', count: 8 }] as unknown as AgriLogResponse['labour'];

async function draw(draft: Partial<AgriLogResponse> = {}) {
    h.fetchOperators.mockResolvedValueOnce([
        { id: SHANKAR, displayName: 'शंकर', isActive: true },
        { id: RAMESH, displayName: 'रमेश', isActive: true },
    ]);
    const onConfirm = vi.fn();
    render(<AttendanceResult draft={{ ...base, labour: crew, ...draft }} anchor={anchor} farmId={FARM} onConfirm={onConfirm} onSpeakMore={vi.fn()} />);
    await waitFor(() => expect(h.fetchOperators).toHaveBeenCalledWith(FARM));
    await new Promise(r => setTimeout(r, 0));
    return onConfirm;
}
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'बरोबर' }));
const savedLine = (onConfirm: ReturnType<typeof vi.fn>) => (onConfirm.mock.calls[0][0] as AgriLogResponse).labour[0];

beforeEach(() => { h.enqueue.mockClear(); h.fetchOperators.mockReset(); h.language = 'mr'; });
afterEach(cleanup);

describe('हजेरी confirm card — कोणामार्फत?', () => {
    it('the tap opens the farm\'s people plus "कोणी नाही" and "माहीत नाही"; the person chosen rides the labour line', async () => {
        const onConfirm = await draw();
        fireEvent.click(screen.getByRole('button', { name: 'कोणामार्फत?' }));
        const list = screen.getByTestId('attendance-through-list-l1');
        expect(within(list).getByText('शंकर')).toBeInTheDocument();
        expect(within(list).getByText('रमेश')).toBeInTheDocument();
        expect(within(list).getByRole('button', { name: 'कोणी नाही' })).toBeInTheDocument();
        expect(within(list).getByRole('button', { name: 'माहीत नाही' })).toBeInTheDocument();
        fireEvent.click(within(list).getByTestId(`attendance-through-pick-${SHANKAR}`));
        expect(screen.getByTestId('attendance-through-l1')).toHaveTextContent('कोणामार्फत: शंकर');
        confirm();
        const line = savedLine(onConfirm);
        expect(line.engagedThroughFieldOperatorId).toBe(SHANKAR);
        expect(line.count).toBe(8); // P7
        // choosing who brought the crew writes no हजेरी mark for him (his own day is his own mark)
        expect(h.enqueue).not.toHaveBeenCalled();
    });

    it('nothing chosen: the field is not there', async () => {
        const onConfirm = await draw();
        confirm();
        expect(Object.prototype.hasOwnProperty.call(savedLine(onConfirm), 'engagedThroughFieldOperatorId')).toBe(false);
    });

    it('"कोणी नाही" and "माहीत नाही" are answers on screen, never a value on the record', async () => {
        for (const answer of ['कोणी नाही', 'माहीत नाही']) {
            const onConfirm = await draw();
            fireEvent.click(screen.getByRole('button', { name: 'कोणामार्फत?' }));
            fireEvent.click(within(screen.getByTestId('attendance-through-list-l1')).getByTestId(`attendance-through-pick-${SHANKAR}`));
            fireEvent.click(screen.getByTestId('attendance-through-l1'));
            fireEvent.click(screen.getByRole('button', { name: answer }));
            expect(screen.getByTestId('attendance-through-l1')).toHaveTextContent(`कोणामार्फत: ${answer}`);
            confirm();
            expect(Object.prototype.hasOwnProperty.call(savedLine(onConfirm), 'engagedThroughFieldOperatorId')).toBe(false);
            cleanup();
        }
    });

    it('a record already saved (an edit) shows no "कोणामार्फत?" — the server cannot take it on a saved entry yet', async () => {
        await draw({ originalLogId: 'log-saved' } as Partial<AgriLogResponse>);
        expect(screen.queryByRole('button', { name: 'कोणामार्फत?' })).toBeNull();
    });

    it('English mode: the English twins', async () => {
        h.language = 'en';
        await draw();
        fireEvent.click(screen.getByRole('button', { name: 'Through whom?' }));
        expect(screen.getByRole('button', { name: 'Nobody' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Not known' })).toBeInTheDocument();
    });
});
