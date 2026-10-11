// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE ATTENDANCE DOOR IS OPEN AND IT TELLS THE TRUTH — the real-mount suite.
 * Replaces LabourFeature.attendanceDoorClosed.test.tsx (the door-closed pin).
 * spec: LABOUR_COMPLETION_SPEC §6/§8, 2026-08-25-prod-cutover-waves.
 *
 * Nothing on the door's own path is mocked: the REAL FarmContextProvider (fed
 * a real-shaped /me), the REAL useLabourState, LabourHub, LabourFeature,
 * Attendance, AttendanceRoster, MarkAttendanceCommand and MutationQueue (over
 * fake-indexeddb, so "exactly one mark per touched person" is read straight
 * out of the queue, not off a spy). Only what sits BELOW the feature is
 * stubbed: the network clients and the background sync trigger.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act, configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Below the feature: the network and the device. ──────────────────────
const mockFetchMeContext = vi.fn();
vi.mock('../../../../core/session/MeContextService', () => ({
    fetchMeContext: (opts?: { force?: boolean }) => mockFetchMeContext(opts),
    invalidateMeContext: vi.fn(),
}));

vi.mock('../../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ isAuthenticated: true }),
    useOptionalAuth: () => ({ authStatus: 'authenticated', session: { accessToken: 'test-token' } }),
}));

const mockFetchLabourData = vi.fn();
vi.mock('../../data/labourClient', () => ({
    fetchLabourData: (farmId: string, timeWindow: string) => mockFetchLabourData(farmId, timeWindow),
}));

const mockFetchFieldOperators = vi.fn();
const mockCreateFieldOperator = vi.fn();
const mockAttachFieldOperator = vi.fn();
vi.mock('../../data/fieldOperatorClient', () => ({
    fetchFieldOperators: (farmId: string) => mockFetchFieldOperators(farmId),
    createFieldOperator: (farmId: string, name: string, full?: string) => mockCreateFieldOperator(farmId, name, full),
    attachFieldOperator: (...a: unknown[]) => mockAttachFieldOperator(...a),
}));

const mockTriggerNow = vi.fn();
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: (...a: unknown[]) => mockTriggerNow(...a) },
}));
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: vi.fn() },
}));

import { FarmContextProvider } from '../../../../core/session/FarmContext';
import LabourFeature from '../LabourFeature';
import { LABOUR_MOCK, EMPTY_LABOUR_DATA, type LabourData } from '../../labourMock';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { getRootStore, resetRootStore } from '../../../../app/state/RootStore';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { t as translate } from '../../../../i18n/translations';
import { SYNC_HONESTY_I18N_KEYS } from '../../../sync/status/syncHonestyState';
import { writeCachedRoster } from '../../data/fieldOperatorRosterCache';
import type { DailyLog } from '../../../../types';

// Real providers + a real IndexedDB queue: the first mount in a cold, heavily
// loaded full-suite run needs more than the 1s default.
configure({ asyncUtilTimeout: 6000 });

const ON_PHONE = translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr');

const CAPTURE_TILE = 'हजेरी घ्या';
const CAPTURE_SCREEN_TITLE = 'आजची हजेरी';
const NO_WORK_TILE = 'काम झालं नाही, पण मजूर आले';

/** Every string the old, unfinished screen carried — none may exist anywhere. */
const FALSE_STRINGS = [
    'आज किती जण होते?',
    'तुम्ही बोललात त्यातून',
    'किमान',
    '+ २ जण',
    'तपासणीसाठी',
    'मंजुरीसाठी',
    'इतिहासातून किंवा नवीन',
    'शिफ्ट',
];

const REAL_FARM = {
    farmId: 'f1a2b3c4-0000-4000-8000-000000000001',
    name: 'पुरवेश यांची शेती',
    farmCode: null,
    ownerAccountId: '00000000-0000-0000-0000-0000000000c2',
    role: 'Owner',
    status: 'Active',
    joinedVia: 'created',
    plan: 'Free' as const,
    planValidUntilUtc: null,
    capabilities: { canInvite: true, canVerify: true, canAddCost: true, canSeeBilling: true },
};

const ME_CONTEXT = {
    me: {
        userId: 'u1', displayName: 'पुरवेश', phoneMasked: '88****8888',
        phoneVerifiedAtUtc: null, preferredLanguage: 'mr', authMode: 'otp',
    },
    farms: [REAL_FARM],
    share: { referralCode: null, referralsTotal: 0, referralsQualified: 0, benefitsEarned: 0 },
    alerts: [],
    serverTimeUtc: '2026-09-03T06:00:00Z',
};

const OP_A = { id: 'aaaaaaaa-0000-4000-8000-00000000000a', displayName: 'रमेश', isActive: true };
const OP_B = { id: 'bbbbbbbb-0000-4000-8000-00000000000b', displayName: 'सुनीता', isActive: true };
const OP_C = { id: 'cccccccc-0000-4000-8000-00000000000c', displayName: 'संदीप', isActive: true };
const OP_D = { id: 'dddddddd-0000-4000-8000-00000000000d', displayName: 'विलास', isActive: true };

type FeatureProps = Partial<React.ComponentProps<typeof LabourFeature>>;
const renderRealFarm = (props: FeatureProps = {}) => render(
    <FarmContextProvider>
        <LabourFeature onExit={() => {}} history={[]} lastLabourLogIds={[]} {...props} />
    </FarmContextProvider>,
);

const attendanceMarks = async () => (await getDatabase().mutationQueue
    .where('mutationType').equals(SyncMutationName.AttendanceMark).toArray())
    .map((r) => r.payload as Record<string, unknown>);

const openCaptureScreen = async () => {
    await waitFor(() => expect(screen.getByText(CAPTURE_TILE)).toBeInTheDocument());
    fireEvent.click(screen.getByText(CAPTURE_TILE));
    await waitFor(() => expect(screen.getByTestId('attendance-screen')).toBeInTheDocument());
};

import { setAttendanceDoorEnabled } from '../../attendanceDoor';

// The server's read-out says NOTHING about today (journey fix D4: a day the server
// states a headcount for is anchored, so the grey-hero / no-work-tile lane would
// rightly not be offered). LABOUR_MOCK itself states 12 on the farm today.
const LABOUR_NO_TODAY = {
    ...LABOUR_MOCK,
    home: { ...LABOUR_MOCK.home, onFarmToday: null, rojandariToday: null, ukteToday: null },
};

// Early-access switch ON: these suites pin the door's behaviour once opened (device-switch spec).
beforeEach(() => { setAttendanceDoorEnabled(true); });

beforeEach(() => {
    mockFetchMeContext.mockResolvedValue(ME_CONTEXT);
    mockFetchLabourData.mockResolvedValue(LABOUR_NO_TODAY);
    mockFetchFieldOperators.mockResolvedValue([OP_A, OP_B, OP_C, OP_D]);
    mockTriggerNow.mockResolvedValue(undefined);
});

afterEach(async () => {
    cleanup();
    mockFetchMeContext.mockReset();
    mockFetchLabourData.mockReset();
    mockFetchFieldOperators.mockReset();
    mockCreateFieldOperator.mockReset();
    mockAttachFieldOperator.mockReset();
    mockTriggerNow.mockReset();
    window.localStorage.clear();
    await getDatabase().mutationQueue.clear();
    resetRootStore();
});

describe('attendance door — opens, and says only true things', () => {
    it.each([
        ['populated farm', LABOUR_MOCK],
        ['zero-operator farm', EMPTY_LABOUR_DATA],
    ])('%s: the tile is there and opens आजची हजेरी', async (_name, fixture) => {
        mockFetchLabourData.mockResolvedValue(fixture);
        renderRealFarm();

        await waitFor(() => expect(screen.getByText(CAPTURE_TILE)).toBeInTheDocument());
        expect(screen.getByText('हजेरी वही')).toBeInTheDocument(); // positive control: the hub rendered
        fireEvent.click(screen.getByText(CAPTURE_TILE));

        await waitFor(() => expect(screen.getByText(CAPTURE_SCREEN_TITLE)).toBeInTheDocument());
    });

    it('none of the false strings exist anywhere on the screen', async () => {
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());

        const text = document.body.textContent ?? '';
        FALSE_STRINGS.forEach((s) => expect(text).not.toContain(s));
        // The two removed controls, structurally: no +/- stepper, no shift buttons.
        expect(screen.queryByText('−')).toBeNull();
        expect(screen.queryByText('जण')).toBeNull();
    });

    it('CRASH CASE: wire attendance rows keyed by an operator id missing from people render without throwing', async () => {
        const crashing: LabourData = {
            ...LABOUR_MOCK,
            attendance: {
                ...LABOUR_MOCK.attendance,
                // the REAL wire shape: FieldOperator ids, absent from `people`
                rows: [{ personId: OP_A.id, status: 'present' }, { personId: 'op-not-in-people', status: 'present' }],
            },
        };
        mockFetchLabourData.mockResolvedValue(crashing);
        renderRealFarm();
        await openCaptureScreen();

        // The roster is the FieldOperator list; `data.people` is never indexed.
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());
        expect(within(screen.getByTestId(`att-row-${OP_A.id}`)).getByText('रमेश')).toBeInTheDocument();
    });

    it('label is plain बरोबर, the approved honesty line sits above it, and nothing is pre-selected', async () => {
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());

        const save = screen.getByTestId('att-save');
        expect(save).toHaveTextContent(/^\s*बरोबर\s*$/);
        expect(screen.getByTestId('att-honesty')).toHaveTextContent('"बरोबर" दाबेपर्यंत काहीही जतन होणार नाही.');
        // a save with nothing stated is not possible
        expect(save).toBeDisabled();
        document.querySelectorAll('[aria-pressed]').forEach((el) => expect(el).toHaveAttribute('aria-pressed', 'false'));
    });

    it('नाव जोडा creates a real person, lists them unmarked, and never attaches or marks', async () => {
        const NEW_OP = { id: 'eeeeeeee-0000-4000-8000-00000000000e', displayName: 'गणेश', isActive: true };
        mockCreateFieldOperator.mockResolvedValue(NEW_OP);
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('att-add-open'));
        fireEvent.change(screen.getByTestId('att-new-name'), { target: { value: 'गणेश' } });
        fireEvent.click(screen.getByTestId('att-add-submit'));

        await waitFor(() => expect(screen.getByTestId(`att-row-${NEW_OP.id}`)).toBeInTheDocument());
        expect(mockCreateFieldOperator).toHaveBeenCalledTimes(1);
        expect(mockCreateFieldOperator).toHaveBeenCalledWith(REAL_FARM.farmId, 'गणेश', undefined);
        expect(mockAttachFieldOperator).not.toHaveBeenCalled();
        expect(await attendanceMarks()).toHaveLength(0);
        // unmarked: nothing is pressed on the new row
        within(screen.getByTestId(`att-row-${NEW_OP.id}`)).getAllByRole('button')
            .forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'false'));
    });

    it('two people with the same name stay two rows (B2), told apart on screen', async () => {
        const TWIN = { id: 'ffffffff-0000-4000-8000-00000000000f', displayName: 'रमेश', isActive: true };
        mockFetchFieldOperators.mockResolvedValue([OP_A, TWIN]);
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${TWIN.id}`)).toBeInTheDocument());
        expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument();
        expect(screen.getAllByText('सारखं नाव — माणूस वेगळा')).toHaveLength(2);
    });
});

describe('attendance door — the save', () => {
    it('queues exactly ONE attendance.mark per touched person, none for the untouched, with the mapped facts', async () => {
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());

        fireEvent.click(screen.getByTestId(`att-day-Full-${OP_A.id}`));                 // A: आला
        fireEvent.click(screen.getByTestId(`att-day-Half-${OP_B.id}`));                 // B: अर्धा + रात्र
        fireEvent.click(screen.getByTestId(`att-night-${OP_B.id}`));
        fireEvent.click(screen.getByTestId(`att-day-Absent-${OP_C.id}`));               // C: आला नाही
        // D untouched

        fireEvent.click(screen.getByTestId('att-save'));
        await waitFor(async () => expect(await attendanceMarks()).toHaveLength(3));

        const marks = await attendanceMarks();
        const byOp = (id: string) => marks.filter((m) => m.fieldOperatorId === id);
        expect(byOp(OP_A.id)).toHaveLength(1);
        expect(byOp(OP_A.id)[0]).toMatchObject({ dayMark: 'Full', farmId: REAL_FARM.farmId, workDate: getDateKey() });
        expect(byOp(OP_A.id)[0]).not.toHaveProperty('nightMark');
        expect(byOp(OP_B.id)[0]).toMatchObject({ dayMark: 'Half', nightMark: 'Worked' });
        expect(byOp(OP_C.id)[0]).toMatchObject({ dayMark: 'Absent' });
        expect(byOp(OP_D.id)).toHaveLength(0);
        // no money, no headcount ever rides a mark
        marks.forEach((m) => {
            expect(Object.keys(m).sort()).toEqual(expect.not.arrayContaining(['headcount', 'amount', 'wage', 'count']));
        });
    });

    it('a night-only statement and optional hours are carried; no day fact is invented', async () => {
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_D.id}`)).toBeInTheDocument());

        fireEvent.click(screen.getByTestId(`att-night-${OP_D.id}`));
        fireEvent.change(screen.getByTestId(`att-hours-${OP_D.id}`), { target: { value: '4' } });
        fireEvent.click(screen.getByTestId('att-save'));

        await waitFor(async () => expect(await attendanceMarks()).toHaveLength(1));
        const [m] = await attendanceMarks();
        expect(m).toMatchObject({ fieldOperatorId: OP_D.id, nightMark: 'Worked', hoursWorked: 4 });
        expect(m).not.toHaveProperty('dayMark');
    });

    it('double-tapping बरोबर is ONE mark per person, not two', async () => {
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());
        fireEvent.click(screen.getByTestId(`att-day-Full-${OP_A.id}`));

        const save = screen.getByTestId('att-save');
        fireEvent.click(save);
        fireEvent.click(save);
        fireEvent.click(save);

        await waitFor(async () => expect(await attendanceMarks()).toHaveLength(1));
        await waitFor(() => expect(screen.queryByTestId('attendance-screen')).toBeNull());
        expect(await attendanceMarks()).toHaveLength(1);
    });

    it('says only what is true: the phone-remembers line (never "saved"), then lands on the हजेरी वही', async () => {
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());
        fireEvent.click(screen.getByTestId(`att-day-Full-${OP_A.id}`));
        fireEvent.click(screen.getByTestId('att-save'));

        await waitFor(() => expect(screen.getByText(ON_PHONE)).toBeInTheDocument());
        expect(ON_PHONE).toContain('✓');
        // navigated off the capture screen onto the register
        await waitFor(() => expect(screen.queryByTestId('attendance-screen')).toBeNull());
        expect(screen.getAllByText('हजेरी वही').length).toBeGreaterThan(0);
        expect(document.body.textContent ?? '').not.toMatch(/सेव्ह झाल|जतन झाल|saved/i);
        expect(mockTriggerNow).toHaveBeenCalled();
    });

    it('a refetch caused by sync cannot wipe a half-filled screen (it waits until he leaves)', async () => {
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());
        fireEvent.click(screen.getByTestId(`att-day-Full-${OP_A.id}`));
        const callsBefore = mockFetchLabourData.mock.calls.length;

        act(() => {
            getRootStore().sync.send({ type: 'TRIGGER' });
            getRootStore().sync.send({ type: 'SYNC_DONE' });
        });

        expect(screen.getByTestId(`att-day-Full-${OP_A.id}`)).toHaveAttribute('aria-pressed', 'true');
        expect(mockFetchLabourData.mock.calls.length).toBe(callsBefore);
    });
});

describe('attendance door — refetch on sync acknowledgement', () => {
    it('SYNC_DONE refetches the labour data while the hub is showing', async () => {
        renderRealFarm();
        await waitFor(() => expect(screen.getByText(CAPTURE_TILE)).toBeInTheDocument());
        const callsBefore = mockFetchLabourData.mock.calls.length;

        act(() => {
            getRootStore().sync.send({ type: 'TRIGGER' });
            getRootStore().sync.send({ type: 'SYNC_DONE' });
        });

        await waitFor(() => expect(mockFetchLabourData.mock.calls.length).toBeGreaterThan(callsBefore));
    });
});

describe('attendance door — offline', () => {
    it('with the labour fetch failing, the door is still there and runs on the cached roster', async () => {
        mockFetchLabourData.mockRejectedValue(new Error('offline'));
        mockFetchFieldOperators.mockRejectedValue(new Error('offline'));
        // The device read this roster once while it had signal.
        renderRealFarm();
        await waitFor(() => expect(screen.getByTestId('attendance-door-offline')).toBeInTheDocument());
        writeCachedRoster(REAL_FARM.farmId, [OP_A, OP_B]);

        fireEvent.click(screen.getByTestId('attendance-door-offline'));
        await waitFor(() => expect(screen.getByTestId('attendance-screen')).toBeInTheDocument());

        // cached names are listed, no fabricated roster, creation is blocked
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());
        expect(screen.getByTestId(`att-row-${OP_B.id}`)).toBeInTheDocument();
        expect(screen.queryByTestId(`att-row-${OP_C.id}`)).toBeNull();
        fireEvent.click(screen.getByTestId('att-add-open'));
        expect(screen.getByTestId('att-add-blocked')).toBeInTheDocument();
        expect(screen.getByTestId('att-add-submit')).toBeDisabled();

        // and a mark still queues locally
        fireEvent.click(screen.getByTestId(`att-day-Full-${OP_A.id}`));
        fireEvent.click(screen.getByTestId('att-save'));
        await waitFor(async () => expect(await attendanceMarks()).toHaveLength(1));
    });

    it('offline with NO cached roster: the honest failure banner, no invented names', async () => {
        mockFetchLabourData.mockRejectedValue(new Error('offline'));
        mockFetchFieldOperators.mockRejectedValue(new Error('offline'));
        renderRealFarm();
        await waitFor(() => expect(screen.getByTestId('attendance-door-offline')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('attendance-door-offline'));

        await waitFor(() => expect(screen.getAllByText('माहिती आणता आली नाही').length).toBeGreaterThan(0));
        expect(document.querySelector('[data-testid^="att-row-"]')).toBeNull();
    });
});

describe('attendance door — no-work day (काम झालं नाही, पण मजूर आले)', () => {
    const noWorkLane = (extra: FeatureProps = {}) => {
        const declare = vi.fn().mockResolvedValue(true);
        const begin = vi.fn();
        renderRealFarm({ onDeclareNoWorkDay: declare, onBeginNoWorkLane: begin, ...extra });
        return { declare, begin };
    };

    it('shown only while the voice hero is grey (no work logged), and not without the declare path', async () => {
        renderRealFarm();                                    // no declare path wired
        await waitFor(() => expect(screen.getByText(CAPTURE_TILE)).toBeInTheDocument());
        expect(screen.queryByText(NO_WORK_TILE)).toBeNull();
        cleanup();

        noWorkLane();                                        // history [] => no anchor => grey hero
        await waitFor(() => expect(screen.getByText(NO_WORK_TILE)).toBeInTheDocument());
    });

    it('marks the named people AND declares the day once, with the chosen reason; skipping the reason still saves', async () => {
        const { declare, begin } = noWorkLane();
        await waitFor(() => expect(screen.getByText(NO_WORK_TILE)).toBeInTheDocument());
        fireEvent.click(screen.getByText(NO_WORK_TILE));
        await waitFor(() => expect(screen.getByTestId('att-no-work-question')).toHaveTextContent('आज कोण आले होते आणि काम का झालं नाही?'));
        expect(begin).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());

        fireEvent.click(screen.getByTestId(`att-day-Full-${OP_A.id}`));
        fireEvent.click(screen.getByTestId('att-cause-WEATHER'));
        fireEvent.click(screen.getByTestId('att-save'));

        await waitFor(() => expect(declare).toHaveBeenCalledTimes(1));
        expect(declare).toHaveBeenCalledWith('WEATHER');
        expect(await attendanceMarks()).toHaveLength(1);
        // no unnamed headcount is ever recorded (Q2)
        expect((await attendanceMarks())[0]).not.toHaveProperty('count');
    });

    it('skipping the reason chip still saves the day (P9)', async () => {
        const { declare } = noWorkLane();
        await waitFor(() => expect(screen.getByText(NO_WORK_TILE)).toBeInTheDocument());
        fireEvent.click(screen.getByText(NO_WORK_TILE));
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_B.id}`)).toBeInTheDocument());
        fireEvent.click(screen.getByTestId(`att-day-Full-${OP_B.id}`));
        fireEvent.click(screen.getByTestId('att-save'));
        await waitFor(() => expect(declare).toHaveBeenCalledWith(undefined));
    });

    it('a day already declared as no-work is not declared a second time', async () => {
        const today = getDateKey();
        const declaredToday = [{ id: 'l1', date: today, dayOutcome: 'NO_WORK_PLANNED' }] as unknown as DailyLog[];
        const { declare } = noWorkLane({ history: declaredToday });
        await waitFor(() => expect(screen.getByText(NO_WORK_TILE)).toBeInTheDocument());
        fireEvent.click(screen.getByText(NO_WORK_TILE));
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());
        fireEvent.click(screen.getByTestId(`att-day-Full-${OP_A.id}`));
        fireEvent.click(screen.getByTestId('att-save'));
        await waitFor(async () => expect(await attendanceMarks()).toHaveLength(1));
        expect(declare).not.toHaveBeenCalled();
    });

    it('when the day could not be declared, nothing is claimed and the screen stays so he can retry', async () => {
        const declare = vi.fn().mockResolvedValue(false);
        renderRealFarm({ onDeclareNoWorkDay: declare, onBeginNoWorkLane: vi.fn() });
        await waitFor(() => expect(screen.getByText(NO_WORK_TILE)).toBeInTheDocument());
        fireEvent.click(screen.getByText(NO_WORK_TILE));
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());
        fireEvent.click(screen.getByTestId(`att-day-Full-${OP_A.id}`));
        fireEvent.click(screen.getByTestId('att-save'));

        await waitFor(() => expect(screen.getByText('पुन्हा प्रयत्न करा')).toBeInTheDocument());
        expect(screen.queryByText(ON_PHONE)).toBeNull();
        expect(screen.getByTestId('attendance-screen')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('att-save')).not.toBeDisabled());
    });
});

describe('attendance door — no gate left behind', () => {
    const stripComments = (src: string) => src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[^\S\r\n]*\/\/.*$/gm, '');
    const read = (rel: string) => stripComments(readFileSync(join(process.cwd(), 'src', rel), 'utf8'));

    it('LabourHub has no SHOW_ATTENDANCE constant and no `|| isPreview` escape; all visibility goes through attendanceDoor', () => {
        const hub = read('features/labour/components/LabourHub.tsx');
        expect(hub).not.toMatch(/SHOW_ATTENDANCE/);
        expect(hub).not.toMatch(/\|\|\s*isPreview/);
        expect(hub).not.toMatch(/isPreview/);
        expect(hub).toMatch(/isAttendanceDoorEnabled\(\)/);
        const feature = read('features/labour/components/LabourFeature.tsx');
        expect(feature).not.toMatch(/isPreview/);
        expect(feature).toMatch(/isAttendanceDoorEnabled\(\)/);
    });

    it('the door function reads no preview, mock or build-time signal (only the per-device switch)', () => {
        const door = read('features/labour/attendanceDoor.ts');
        expect(door).not.toMatch(/isPreview|import\.meta|process\.env|LABOUR_MOCK/);
    });

    it('the voice hero is still anchor-gated (no work logged => grey, with the approved reason)', async () => {
        renderRealFarm();                                         // history [] => no anchor
        await waitFor(() => expect(screen.getByText(CAPTURE_TILE)).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /बोलून हजेरी घ्या/ })).toBeDisabled();
        expect(screen.getByTestId('labour-no-anchor-reason')).toBeInTheDocument();
    });

    it('with NO farm context at all (the ?preview=labour mount) nothing can be saved or acknowledged', async () => {
        render(<LabourFeature onExit={() => {}} />);
        await waitFor(() => expect(screen.getByText(CAPTURE_TILE)).toBeInTheDocument());
        fireEvent.click(screen.getByText(CAPTURE_TILE));
        await waitFor(() => expect(screen.getByTestId('attendance-screen')).toBeInTheDocument());

        expect(mockFetchFieldOperators).not.toHaveBeenCalled();
        expect(screen.getByTestId('att-save')).toBeDisabled();
        expect(screen.getByTestId('att-add-open')).toBeDisabled();
        expect(screen.queryByText(ON_PHONE)).toBeNull();
        expect(await attendanceMarks()).toHaveLength(0);
    });
});
