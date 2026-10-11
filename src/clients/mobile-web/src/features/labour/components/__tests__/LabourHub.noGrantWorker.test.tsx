// spec: 2026-08-25-prod-cutover-waves
// @vitest-environment jsdom
//
// N1 (Labour V2 journeys, 2026-10-11): a plain Worker with no labour grant
// opened the Labour hub on a farm with other people and got the error screen
// "Cannot read properties of undefined (reading 'role')". The server had
// narrowed `people` to him but still listed the whole farm in `topLevelIds`.
// This mounts the REAL hub on the exact wire shape that crashed, through the
// real DTO mapper, and also on the narrowed shape the fixed server sends.
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockGet = vi.fn();
vi.mock('../../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { http: { get: (...args: unknown[]) => mockGet(...args) } },
}));

import LabourHub from '../LabourHub';
import MukadamDetail from '../MukadamDetail';
import { fetchLabourData, type LabourDataDto } from '../../data/labourClient';

const person = (id: string, name: string, role: string, memberIds: string[] | null = null) => ({
    id, name, initial: name[0], tone: 'em', role, verified: true, temporary: false,
    taskScope: null, appointedById: null, recordedWages: null, paid: null, advance: null,
    todayStatus: null, daysThisWeek: null, memberIds, trust: null, access: 'review',
    daysActive: 3, cleanRecord: null,
});

// The response that crashed: people narrowed to Raju, topLevelIds not.
const crashingWire = (): LabourDataDto => ({
    topLevelIds: ['raju', 'shankar', 'santosh'],
    people: [person('raju', 'Raju', 'worker')],
    dashboard: {
        weekLabel: '', windowFrom: '', windowTo: '', insight: '', manDays: null, manDaysTrend: 0,
        wages: null, advances: null, owed: null, logs: 0, pending: 0, plots: [], money: null,
    },
    ledger: { weekLabel: '', days: [], rows: [], crewRows: [] },
    view: 'own',
    home: { rojandariStated: null, ukteAgreed: null, onFarmToday: null, rojandariToday: null, ukteToday: null },
    review: [],
    attendance: { plot: '', headcount: null, rows: [] },
} as unknown as LabourDataDto);

const noop = () => {};
const hubProps = (data: Awaited<ReturnType<typeof fetchLabourData>>) => ({
    data, onOpenMukadam: noop, onOpenPerson: noop, onAttendance: noop,
    onDashboard: noop, onLedger: noop, onReview: noop, onGoToLog: noop,
});

describe('LabourHub - a plain Worker whose response names people it does not contain', () => {
    afterEach(() => { cleanup(); mockGet.mockReset(); });

    it('mounts without throwing and shows only the person that exists', async () => {
        mockGet.mockResolvedValue({ data: crashingWire() });
        const data = await fetchLabourData('farm-1');

        expect(() => render(<LabourHub {...hubProps(data)} />)).not.toThrow();
        expect(screen.getByText('Raju')).toBeInTheDocument();
        expect(screen.queryByText('Shankar')).toBeNull();
    });

    it('with nobody resolvable it shows the honest empty state, not a crash', async () => {
        const wire = crashingWire();
        wire.people = [];
        mockGet.mockResolvedValue({ data: wire });
        const data = await fetchLabourData('farm-1');

        expect(() => render(<LabourHub {...hubProps(data)} />)).not.toThrow();
        expect(screen.getByText('अजून कोणाचंही नाव जोडलेलं नाही')).toBeInTheDocument();
    });

    it('a team page tolerates a member id that is not in people', async () => {
        const wire = crashingWire();
        wire.people = [person('shankar', 'Shankar', 'mukadam', ['raju', 'ghost'])];
        wire.topLevelIds = ['shankar'];
        mockGet.mockResolvedValue({ data: wire });
        const data = await fetchLabourData('farm-1');

        const props = {
            data, personId: 'shankar', onOpenPerson: noop, onOpenMukadam: noop, onAdvance: noop, onSettle: noop,
        };
        expect(() => render(<MukadamDetail {...props} />)).not.toThrow();
    });
});
