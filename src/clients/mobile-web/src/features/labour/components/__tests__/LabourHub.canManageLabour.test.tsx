// spec: 2026-08-25-prod-cutover-waves
// @vitest-environment jsdom
//
// JOURNEY FIX 3 (P3): an UN-GRANTED own-row caller (plain Worker) was still
// offered voice attendance, the manual-attendance tile and the approve buttons,
// all of which the server refuses. The server now SENDS `canManageLabour`; the
// client hides those controls ONLY when it is explicitly false. Absent means
// unknown (old server / old fixture) and keeps today's behaviour. Owner,
// Mukadam (decision Q4: shown the door, refused clearly) and a granted member
// keep every control.
//
// Real LabourHub + real ReviewSheet, fed through the real DTO mapper.
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockGet = vi.fn();
vi.mock('../../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { http: { get: (...args: unknown[]) => mockGet(...args) } },
}));
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: vi.fn() },
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn() },
}));

import LabourHub from '../LabourHub';
import ReviewSheet from '../ReviewSheet';
import { fetchLabourData, type LabourDataDto } from '../../data/labourClient';

const HERO = 'बोलून हजेरी घ्या';
const MANUAL_TILE = 'हजेरी घ्या';
const NO_WORK_TILE = 'काम झालं नाही, पण मजूर आले';

const person = (id: string, name: string, role: string) => ({
    id, name, initial: name[0], tone: 'em', role, verified: true, temporary: false,
    taskScope: null, appointedById: null, recordedWages: null, paid: null, advance: null,
    todayStatus: null, daysThisWeek: null, memberIds: null, trust: null, access: 'review',
    daysActive: 3, cleanRecord: null,
});

const reviewItem = (id: string) => ({
    id, who: 'Raju', initial: 'R', tone: 'em', detail: '2026-10-10', status: 'Draft',
    points: { count: 2, shift: null, task: 'weeding', amount: null, names: [] },
    plot: null, plotScope: 'Farm',
});

const wire = (view: string, canManageLabour?: boolean | null): LabourDataDto => ({
    topLevelIds: ['raju'],
    people: [person('raju', 'Raju', 'worker')],
    dashboard: {
        weekLabel: '', windowFrom: '', windowTo: '', insight: '', manDays: null, manDaysTrend: 0,
        wages: null, advances: null, owed: null, logs: 0, pending: 2, plots: [], money: null,
    },
    ledger: { weekLabel: '', days: [], rows: [], crewRows: [] },
    view,
    home: { rojandariStated: null, ukteAgreed: null, onFarmToday: null, rojandariToday: null, ukteToday: null },
    review: [reviewItem('l1'), reviewItem('l2')],
    attendance: { plot: '', headcount: null, rows: [] },
    ...(canManageLabour === undefined ? {} : { canManageLabour }),
} as unknown as LabourDataDto);

const load = async (dto: LabourDataDto) => {
    mockGet.mockResolvedValue({ data: dto });
    return fetchLabourData('farm-1');
};

const noop = () => {};
const hubProps = (data: Awaited<ReturnType<typeof load>>, anchorState: 'anchored' | 'no-anchor' = 'anchored') => ({
    data, onOpenMukadam: noop, onOpenPerson: noop, onAttendance: noop, onNoWorkAttendance: noop,
    onDashboard: noop, onLedger: noop, onReview: noop, onGoToLog: noop,
    anchor: (anchorState === 'anchored' ? { state: 'anchored', headcount: 4, logId: 'l1' } : { state: 'no-anchor' }) as never,
});

afterEach(() => { cleanup(); mockGet.mockReset(); });

describe('the mapper carries the server capability signal', () => {
    it.each([[true, true], [false, false]])('canManageLabour=%s arrives as %s', async (wireValue, expected) => {
        expect((await load(wire('own', wireValue))).canManageLabour).toBe(expected);
    });
    it.each([[undefined], [null]])('absent / null (%s) means UNKNOWN, never false', async (wireValue) => {
        expect((await load(wire('own', wireValue))).canManageLabour).toBeUndefined();
    });
});

describe('LabourHub - an un-granted Worker is not offered what the server refuses', () => {
    it('canManageLabour=false hides voice attendance, the manual attendance tile and the no-work door', async () => {
        const data = await load(wire('own', false));
        render(<LabourHub {...hubProps(data, 'no-anchor')} />);
        expect(screen.queryByText(HERO)).toBeNull();
        expect(screen.queryByText(MANUAL_TILE)).toBeNull();
        expect(screen.queryByText(NO_WORK_TILE)).toBeNull();
        // the register and his own review inbox are still his
        expect(screen.getByText('हजेरी वही')).toBeInTheDocument();
        expect(screen.getByText('तपासा')).toBeInTheDocument();
    });

    // Founder ruling 2026-10-12: the manual attendance tile is part of NORMAL
    // Labour navigation (no seven-tap gesture, no device switch). It is shown
    // ONLY when the server explicitly says canManageLabour === true. The server
    // decides (owner/co-owner by role; everyone else, Mukadam included, by an
    // ACTIVE owner grant); the client never inspects roles.
    it.each([
        ['owner', 'owner', true],
        ['co-owner (owner-tier)', 'owner', true],
        ['member with an ACTIVE owner grant (Worker)', 'own', true],
        ['Mukadam with an ACTIVE owner grant', 'crew', true],
    ] as const)('%s sees the voice door AND the manual attendance tile', async (_who, view, flag) => {
        const data = await load(wire(view, flag));
        render(<LabourHub {...hubProps(data)} />);
        expect(screen.getByText(HERO)).toBeInTheDocument();
        expect(screen.getByText(MANUAL_TILE)).toBeInTheDocument();
    });

    it.each([
        ['Worker, un-granted / grant expired / grant revoked (server says false)', 'own', false],
        ['Mukadam, un-granted / grant expired / grant revoked (server says false)', 'crew', false],
    ] as const)('%s: no manual attendance tile, no voice door', async (_who, view, flag) => {
        const data = await load(wire(view, flag));
        render(<LabourHub {...hubProps(data, 'no-anchor')} />);
        expect(screen.queryByText(MANUAL_TILE)).toBeNull();
        expect(screen.queryByText(NO_WORK_TILE)).toBeNull();
        expect(screen.queryByText(HERO)).toBeNull();
    });

    it('old server shape (flag absent): the manual attendance tile and no-work door stay HIDDEN', async () => {
        const data = await load(wire('own', undefined));
        render(<LabourHub {...hubProps(data, 'no-anchor')} />);
        expect(screen.queryByText(MANUAL_TILE)).toBeNull();
        expect(screen.queryByText(NO_WORK_TILE)).toBeNull();
    });

    it('there is no hidden gesture: the screen title does nothing on tap', async () => {
        const data = await load(wire('own', false));
        render(<LabourHub {...hubProps(data)} />);
        const title = screen.queryByText('कामाचा हिशोब');
        if (title) for (let i = 0; i < 9; i++) title.click();
        expect(screen.queryByText(MANUAL_TILE)).toBeNull();
    });

    it('control: with no work logged today the owner is still offered the no-work door', async () => {
        const data = await load(wire('owner', true));
        render(<LabourHub {...hubProps(data, 'no-anchor')} />);
        expect(screen.getByText(NO_WORK_TILE)).toBeInTheDocument();
    });
});

describe('ReviewSheet - approve / approve-all follow the same signal', () => {
    const sheet = async (flag: boolean | undefined) => {
        const data = await load(wire('own', flag));
        render(<ReviewSheet open data={data} onClose={noop} onToast={noop} />);
    };

    it('canManageLabour=false: no मंजूर, no सगळं मंजूर; the cards and शंका remain', async () => {
        await sheet(false);
        expect(screen.getByTestId('review-card-l1')).toBeInTheDocument();
        expect(screen.queryByTestId('review-approve-l1')).toBeNull();
        expect(screen.queryByTestId('review-approve-all')).toBeNull();
        expect(screen.getByTestId('review-query-l1')).toBeInTheDocument();
    });

    it.each([[true], [undefined]])('canManageLabour=%s keeps approve and approve-all', async (flag) => {
        await sheet(flag);
        expect(screen.getByTestId('review-approve-l1')).toBeInTheDocument();
        expect(screen.getByTestId('review-approve-all')).toBeInTheDocument();
    });
});
