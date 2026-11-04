// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 screen 7, section 10).
 *   - Each name on the हजेरी list shows its level: फोन पडताळलेला / कार्ड, or "पूर्ण करा — फोन व पिन". The level is
 *     information, never a gate: marking हजेरी works the same for every level, and the हजेरी screen's quick add asks
 *     only a name (P9: work records never need a phone or a PIN).
 *   - Existing name-only workers get the calm "यांचा फोन व पिन भरा" list at most once a day, never blocking.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockFetchFieldOperators = vi.fn();
const mockCreateFieldOperator = vi.fn();
vi.mock('../../data/fieldOperatorClient', () => ({
    fetchFieldOperators: (farmId: string) => mockFetchFieldOperators(farmId),
    createFieldOperator: (...a: unknown[]) => mockCreateFieldOperator(...a),
}));

import AttendanceRoster from '../../components/AttendanceRoster';
import { NameOnlyNudge } from '../NameOnlyNudge';

const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';

const roster = [
    { id: 'ramesh', displayName: 'रमेश पाटील', isActive: true, cardCode: 'SS-7K4M-29QX', identityLevel: 'PhoneVerified', needsPhoneAndPin: false },
    { id: 'sunita', displayName: 'सुनीता पाटील', isActive: true, cardCode: 'SS-AB12-CD34', identityLevel: 'Card', needsPhoneAndPin: false },
    { id: 'balu', displayName: 'बाळू', isActive: true, cardCode: 'SS-EF56-GH78', identityLevel: 'Card', needsPhoneAndPin: true },
];

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
});
afterEach(() => cleanup());

describe('WID — levels on the हजेरी list, never a gate', () => {
    it('shows each name\'s level, and every name can still be marked', async () => {
        mockFetchFieldOperators.mockResolvedValue(roster);
        const onChange = vi.fn();
        render(<AttendanceRoster farmId={FARM} selections={{}} prefills={{}} onChange={onChange} onToast={() => undefined} />);

        const ramesh = await screen.findByTestId('att-row-ramesh');
        expect(within(ramesh).getByTestId('id-badge-verified')).toHaveTextContent('फोन पडताळलेला');
        expect(within(screen.getByTestId('att-row-sunita')).getByTestId('id-badge-card')).toHaveTextContent('कार्ड');
        expect(within(screen.getByTestId('att-row-balu')).getByTestId('id-badge-complete')).toHaveTextContent('पूर्ण करा — फोन व पिन');

        fireEvent.click(screen.getByTestId('att-day-Full-balu'));
        expect(onChange).toHaveBeenCalledWith('balu', expect.objectContaining({ day: 'Full' }));
    });

    it('the हजेरी quick add asks only a name — never a phone or a PIN (P9)', async () => {
        mockFetchFieldOperators.mockResolvedValue([]);
        mockCreateFieldOperator.mockResolvedValue({ id: 'new', displayName: 'गणू', isActive: true, identityLevel: 'Card', needsPhoneAndPin: true });
        render(<AttendanceRoster farmId={FARM} selections={{}} prefills={{}} onChange={() => undefined} onToast={() => undefined} />);
        await waitFor(() => expect(mockFetchFieldOperators).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByTestId('att-add-open')).toBeEnabled());
        fireEvent.click(screen.getByTestId('att-add-open'));
        const form = screen.getByTestId('att-add-form');
        expect(within(form).queryByTestId('add-worker-phone')).toBeNull();
        expect(within(form).queryByTestId('add-worker-pin')).toBeNull();
        fireEvent.change(screen.getByTestId('att-new-name'), { target: { value: 'गणू' } });
        fireEvent.click(screen.getByTestId('att-add-submit'));
        await waitFor(() => expect(mockCreateFieldOperator).toHaveBeenCalledTimes(1));
        expect(mockCreateFieldOperator.mock.calls[0]).toEqual([FARM, 'गणू', undefined]);
    });
});

describe('WID — "यांचा फोन व पिन भरा", at most once a day', () => {
    const DAY = new Date('2026-11-02T06:00:00+05:30');
    const LATER_SAME_DAY = new Date('2026-11-02T20:00:00+05:30');
    const NEXT_DAY = new Date('2026-11-03T06:00:00+05:30');

    it('lists only the workers missing a phone or PIN, opens one on tap, and goes away with "नंतर करा"', () => {
        const onOpen = vi.fn();
        render(<NameOnlyNudge farmId={FARM} workers={roster} onOpen={onOpen} now={() => DAY} />);
        const nudge = screen.getByTestId('nudge-name-only');
        expect(nudge).toHaveTextContent('यांचा फोन व पिन भरा');
        expect(within(nudge).getByTestId('nudge-item-balu')).toBeInTheDocument();
        expect(within(nudge).queryByTestId('nudge-item-ramesh')).toBeNull();
        fireEvent.click(within(nudge).getByTestId('nudge-item-balu'));
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'balu' }));
        fireEvent.click(screen.getByTestId('nudge-later'));
        expect(screen.queryByTestId('nudge-name-only')).toBeNull();
    });

    it('is shown once a day at most: not again the same day, again the next day', () => {
        const first = render(<NameOnlyNudge farmId={FARM} workers={roster} onOpen={() => undefined} now={() => DAY} />);
        expect(screen.getByTestId('nudge-name-only')).toBeInTheDocument();
        first.unmount();

        const second = render(<NameOnlyNudge farmId={FARM} workers={roster} onOpen={() => undefined} now={() => LATER_SAME_DAY} />);
        expect(screen.queryByTestId('nudge-name-only')).toBeNull();
        second.unmount();

        act(() => {
            render(<NameOnlyNudge farmId={FARM} workers={roster} onOpen={() => undefined} now={() => NEXT_DAY} />);
        });
        expect(screen.getByTestId('nudge-name-only')).toBeInTheDocument();
    });

    it('shows nothing when every worker has his phone and PIN', () => {
        render(<NameOnlyNudge farmId={FARM} workers={roster.filter(w => !w.needsPhoneAndPin)} onOpen={() => undefined} now={() => DAY} />);
        expect(screen.queryByTestId('nudge-name-only')).toBeNull();
    });
});
