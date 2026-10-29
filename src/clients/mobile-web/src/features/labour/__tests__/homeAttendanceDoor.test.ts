// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, H10) — the work home's "आजची हजेरी" door:
 * owner tier by the server-told role, or the owner's labour grant as the server last answered it on
 * this phone (newest cached read-out wins); never a worker by role alone; unknown stays closed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWorkerRole, mayOpenAttendanceFromHome, mayShowFarmMoney, readCachedLabourGrant } from '../homeAttendanceDoor';
import { saveLabourReadout } from '../data/labourReadout';
import type { LabourData } from '../labour.types';

const readout = (canManageLabour?: boolean): LabourData => ({
    topLevelIds: [],
    people: {},
    dashboard: { weekLabel: '', insight: '', manDays: 0, manDaysTrend: 0, wages: null, advances: null, owed: null, logs: 0, pending: 0, plots: [], money: null },
    ledger: { weekLabel: '', days: [], rows: [], crewRows: [] },
    view: 'owner',
    ...(canManageLabour === undefined ? {} : { canManageLabour }),
    home: { rojandariStated: null, ukteAgreed: null, onFarmToday: 0, rojandariToday: null, ukteToday: null },
    review: [],
    attendance: { plot: '', headcount: null, rows: [], todaysLabourAssignmentId: '' },
} as unknown as LabourData);

afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.useRealTimers(); });

describe('mayOpenAttendanceFromHome', () => {
    it('owner tier opens it; unknown, worker and mukadam without a grant do not', () => {
        expect(mayOpenAttendanceFromHome('PrimaryOwner', undefined)).toBe(true);
        expect(mayOpenAttendanceFromHome('SecondaryOwner', false)).toBe(true);
        expect(mayOpenAttendanceFromHome('Mukadam', undefined)).toBe(false);
        expect(mayOpenAttendanceFromHome(null, undefined)).toBe(false);
        expect(mayOpenAttendanceFromHome('Mukadam', true)).toBe(true);
        expect(isWorkerRole('Worker')).toBe(true);
        expect(isWorkerRole('Mukadam')).toBe(false);
    });
});

describe('mayShowFarmMoney (PLR-D10 I20 / N7, founder D-22 + D-26)', () => {
    it('only the primary account holder sees the farm money; no label grants it', () => {
        expect(mayShowFarmMoney('PrimaryOwner')).toBe(true);
        for (const role of ['SecondaryOwner', 'Mukadam', 'Worker', 'Agronomist', 'Consultant', '', null, undefined]) {
            expect(mayShowFarmMoney(role)).toBe(false);
        }
    });
});

describe('readCachedLabourGrant', () => {
    it('nothing cached, or no user/farm: unknown', () => {
        expect(readCachedLabourGrant('u1', 'f1')).toBeUndefined();
        expect(readCachedLabourGrant(null, 'f1')).toBeUndefined();
    });

    it('reads the server\'s cached answer for THIS user and farm only', () => {
        saveLabourReadout('u1', 'f1', 'alltime', readout(true));
        expect(readCachedLabourGrant('u1', 'f1')).toBe(true);
        expect(readCachedLabourGrant('u2', 'f1')).toBeUndefined();
        expect(readCachedLabourGrant('u1', 'f2')).toBeUndefined();
    });

    it('the NEWEST read-out wins, so a revoked grant is not outlived by an older copy', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-20T08:00:00Z'));
        saveLabourReadout('u1', 'f1', 'week', readout(true));
        vi.setSystemTime(new Date('2026-10-25T08:00:00Z'));
        saveLabourReadout('u1', 'f1', 'alltime', readout(false));
        expect(readCachedLabourGrant('u1', 'f1')).toBe(false);
    });
});
