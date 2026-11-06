// @vitest-environment jsdom
/**
 * D-62 — paid rest days stay possible on the हजेरी screen after the day is declared a rest day: a declared rest day with
 * no labour leaves the हजेरी anchor grey, so the hub still offers "काम झालं नाही, पण मजूर आले" and the names tile.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LabourHub from '../LabourHub';
import { EMPTY_LABOUR_DATA } from '../../labourMock';
import { resolveLabourAnchor } from '../../labourAnchor';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { hasDeclaredNoWorkDay } from '../../../../core/navigation/noWorkDay';
import type { DailyLog } from '../../../../types';

afterEach(cleanup);
const TODAY = getDateKey();
const restLog = { id: 'R1', date: TODAY, dayOutcome: 'NO_WORK_PLANNED', labour: [], cropActivities: [] } as unknown as DailyLog;

describe('D-62 — the paid-rest-day path stays reachable on a declared rest day', () => {
    it('the declared rest day leaves the हजेरी anchor grey, so the hub offers the paid-rest-day tile and the names tile', () => {
        expect(hasDeclaredNoWorkDay([restLog], TODAY)).toBe(true);
        const anchor = resolveLabourAnchor([restLog], TODAY);
        expect(anchor.state).toBe('no-anchor');
        const onNoWorkAttendance = vi.fn();
        const onAttendance = vi.fn();
        render(<LabourHub data={{ ...EMPTY_LABOUR_DATA, canManageLabour: true }} anchor={anchor} history={[restLog]}
            onOpenMukadam={() => {}} onOpenPerson={() => {}} onAttendance={onAttendance} onNoWorkAttendance={onNoWorkAttendance}
            onDashboard={() => {}} onLedger={() => {}} onReview={() => {}} onGoToLog={() => {}} />);
        fireEvent.click(screen.getByText('काम झालं नाही, पण मजूर आले'));
        expect(onNoWorkAttendance).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByText('नावं दाबून हजेरी'));
        expect(onAttendance).toHaveBeenCalledTimes(1);
    });
});
