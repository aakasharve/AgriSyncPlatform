// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, AC2 / MU-6) — the person's own side: a request still
 * waiting for the owner says "मंजुरीची वाट"; a paused seat says "काम थांबवलं — कारण…" in the owner's
 * own words; an Active farm (or an older server that sends no status) says nothing.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { MeFarm } from '../../../../core/session/MeContextService';

let farms: Partial<MeFarm>[] = [];
vi.mock('../../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ meContext: { farms } }),
}));

import AccessStatusNotice, { accessStatusLine } from '../AccessStatusNotice';

afterEach(() => { cleanup(); farms = []; });

describe('AccessStatusNotice', () => {
    it('a waiting request reads "मंजुरीची वाट" with the farm name', () => {
        farms = [{ farmId: 'f1', name: 'Shinde Mala', status: 'PendingApproval' }];
        render(<AccessStatusNotice />);
        const line = screen.getByTestId('access-status-f1');
        expect(line.getAttribute('data-kind')).toBe('waiting');
        expect(line.textContent).toBe('Shinde Mala: मंजुरीची वाट');
    });

    it('a paused seat says the owner\'s reason, and to talk to the owner', () => {
        farms = [{ farmId: 'f2', name: 'Jadhav Wadi', status: 'Suspended', statusReason: '  पाऊस थांबेपर्यंत ' }];
        render(<AccessStatusNotice />);
        expect(screen.getByTestId('access-status-f2').textContent)
            .toBe('Jadhav Wadi: काम थांबवलं — कारण: पाऊस थांबेपर्यंत. मालकाशी बोला.');
    });

    it('a paused seat with no reason still says it is paused (no invented reason)', () => {
        expect(accessStatusLine({ name: 'A', status: 'Suspended', statusReason: null })).toBe('A: काम थांबवलं. मालकाशी बोला.');
    });

    it('Active farms, and farms from an older server with no status, show nothing', () => {
        farms = [{ farmId: 'f3', name: 'X', status: 'Active' }, { farmId: 'f4', name: 'Y' }];
        const { container } = render(<AccessStatusNotice />);
        expect(container.textContent).toBe('');
    });
});
