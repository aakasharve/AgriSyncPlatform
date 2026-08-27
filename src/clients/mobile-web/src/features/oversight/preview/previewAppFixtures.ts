/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Seed fixtures for the full-app dev preview (`OversightAppPreview.tsx`,
 * `?preview=oversight`). Every value here is fabricated for the preview —
 * never fetched from a backend, never read from or written to Dexie.
 *
 * Farm name ("Arve Farm") and two of the four plot names ("Grapes A",
 * "Sugarcane B") are the same literals `AppHeader.oversight.test.tsx`
 * already uses for this app's one seeded demo farmer (4 plots — 2 Grapes +
 * 2 Sugarcane) — reused, not invented a second time. The other two plot
 * names ("Grapes B", "Sugarcane A") extend that same crop+letter
 * convention. The three named workers (Rokade, Jadhav, Shinde) are plain
 * Latin surnames per the task brief — no Marathi is written in this file.
 *
 * `Plot.schedule` is built with `createInitialScheduleInstance` — the SAME
 * function the real onboarding flow uses to give a freshly-created plot its
 * first schedule — rather than a hand-rolled shape, so the scheduler engine
 * (`ClientPlanEngine`/`computeDayState`) that `useAppRouterDerivations`
 * calls sees exactly the shape it already knows how to handle.
 */
import { createInitialScheduleInstance } from '../../scheduler/planning/ClientPlanEngine';
import { getTodayKey, getDateKeyDaysAgo } from '../../../core/domain/services/DateKeyService';
import type {
    CropProfile,
    DailyLog,
    FarmContext,
    FarmerProfile,
    FarmOperator,
    LedgerDefaults,
    PlannedTask,
    Plot,
} from '../../../types';
import { LogVerificationStatus, OperatorCapability, VerificationStatus } from '../../../types';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';

function makePlot(id: string, name: string, cropName: string, plantedDaysAgo: number): Plot {
    const referenceDate = getDateKeyDaysAgo(plantedDaysAgo);
    return {
        id,
        name,
        startDate: referenceDate,
        baseline: { unit: 'Acre', totalArea: 1.5 },
        schedule: createInitialScheduleInstance(id, cropName, referenceDate),
    };
}

/** Two crops, two plots each — the seeded demo farmer's real 4-plot farm. */
export const PREVIEW_CROPS: CropProfile[] = [
    {
        id: 'crop-grapes',
        name: 'Grapes',
        iconName: 'Grape',
        color: 'bg-purple-500',
        plots: [
            makePlot('plot-grapes-a', 'Grapes A', 'Grapes', 210),
            makePlot('plot-grapes-b', 'Grapes B', 'Grapes', 180),
        ],
        supportedTasks: [],
        workflow: [],
    },
    {
        id: 'crop-sugarcane',
        name: 'Sugarcane',
        iconName: 'Sugarcane',
        color: 'bg-emerald-500',
        plots: [
            makePlot('plot-sugarcane-a', 'Sugarcane A', 'Sugarcane', 150),
            makePlot('plot-sugarcane-b', 'Sugarcane B', 'Sugarcane', 90),
        ],
        supportedTasks: [],
        workflow: [],
    },
];

const OWNER_OPERATOR: FarmOperator = {
    id: 'owner',
    name: 'Arve',
    role: 'PRIMARY_OWNER',
    capabilities: Object.values(OperatorCapability) as OperatorCapability[],
    isVerifier: true,
    isActive: true,
};

function worker(id: string, name: string): FarmOperator {
    return {
        id,
        name,
        role: 'WORKER',
        capabilities: [OperatorCapability.LOG_DATA],
        isVerifier: false,
        isActive: true,
    };
}

export const PREVIEW_FARMER_PROFILE: FarmerProfile = {
    name: 'Arve',
    village: 'Nashik',
    phone: '',
    language: 'mr',
    verificationStatus: VerificationStatus.Unverified,
    operators: [
        OWNER_OPERATOR,
        worker('op-rokade', 'Rokade'),
        worker('op-jadhav', 'Jadhav'),
        worker('op-shinde', 'Shinde'),
    ],
    activeOperatorId: 'owner',
    waterResources: [],
    motors: [],
    infrastructure: { waterManagement: 'Decentralized', filtrationType: 'Screen' },
};

/** One farm — deliberately not two. A second farm in the switcher would
 * imply switching actually loads different crops/logs, which this preview
 * (one static seeded dataset) cannot honestly do. */
export const PREVIEW_FARMS: MyFarmDto[] = [
    { farmId: 'farm-preview-1', name: 'Arve Farm', role: 'PrimaryOwner', farmCode: 'PRVW01', subscription: null },
];

/**
 * spec: owner-oversight-loop (Task 12) — additive, purely for browser-
 * verifying `FarmIdentityElement`'s `farmCount >= 2` presentation
 * (`?preview=oversight&farms=multi`, `OversightAppPreview.tsx`). Does NOT
 * contradict `PREVIEW_FARMS`'s own reasoning above: `onSwitchFarm` in both
 * branches is still the same inert no-op (`OversightAppPreview.tsx`), so
 * tapping a row here still never implies a real data reload — only the
 * LIST shown in the sheet, and the header trigger's own shape, changes.
 * The first entry is `PREVIEW_FARMS[0]` itself (same id/name/plots), so the
 * seeded crops/logs/oversight briefing stay identical between the two
 * preview modes — only the farm-count-driven chrome differs.
 */
export const PREVIEW_FARMS_MULTI: MyFarmDto[] = [
    PREVIEW_FARMS[0],
    { farmId: 'farm-preview-2', name: 'Bhosale Vasti', role: 'PrimaryOwner', farmCode: 'PRVW02', subscription: null },
    { farmId: 'farm-preview-3', name: 'Kadam Mala', role: 'SecondaryOwner', farmCode: 'PRVW03', subscription: null },
];

/** Same literal defaults `useAppData.ts` ships for a brand-new farmer —
 * reused, not reinvented. */
export const PREVIEW_LEDGER_DEFAULTS: LedgerDefaults = {
    irrigation: { method: 'Drip', source: 'Well', defaultDuration: 60 },
    labour: { defaultWage: 400, defaultHours: 8, shifts: [] },
    machinery: { defaultRentalCost: 1000, defaultFuelCost: 100 },
};

export const PREVIEW_PLANNED_TASKS: PlannedTask[] = [];

function plotContext(cropId: string, cropName: string, plotId: string, plotName: string): FarmContext {
    return {
        selection: [{ cropId, cropName, selectedPlotIds: [plotId], selectedPlotNames: [plotName] }],
    };
}

function financials(labour = 0, inputs = 0, machinery = 0) {
    return {
        totalLabourCost: labour,
        totalInputCost: inputs,
        totalMachineryCost: machinery,
        grandTotal: labour + inputs + machinery,
    };
}

/**
 * Today's seeded activity, built fresh on every call so "today" always
 * means the real calendar day this preview happens to be opened on — never
 * a fixed narrative date that would drift stale.
 *
 * Timestamps are minutes-ago offsets from the real `Date.now()` (not
 * hand-typed clock strings), so they are always NEWER than any oversight
 * checkpoint a founder could have set in an earlier visit to this same
 * preview — the briefing has something to show on first load regardless of
 * when it is opened.
 */
export function buildPreviewLogs(): DailyLog[] {
    const today = getTodayKey();
    const nowMs = Date.now();
    const minutesAgo = (n: number) => new Date(nowMs - n * 60_000).toISOString();

    return [
        // Rokade — irrigation on Grapes A, then hired labour on Grapes B.
        {
            id: 'log-rokade-1',
            date: today,
            context: plotContext('crop-grapes', 'Grapes', 'plot-grapes-a', 'Grapes A'),
            dayOutcome: 'WORK_RECORDED',
            cropActivities: [],
            irrigation: [{ id: 'irr-1', method: 'drip', source: 'well' }],
            labour: [],
            inputs: [],
            machinery: [],
            meta: { createdAtISO: minutesAgo(240), createdByOperatorId: 'op-rokade' },
            financialSummary: financials(),
        },
        {
            id: 'log-rokade-2',
            date: today,
            context: plotContext('crop-grapes', 'Grapes', 'plot-grapes-b', 'Grapes B'),
            dayOutcome: 'WORK_RECORDED',
            cropActivities: [],
            irrigation: [],
            labour: [{ id: 'lab-1', type: 'HIRED', count: 3, wagePerPerson: 400 }],
            inputs: [],
            machinery: [],
            meta: { createdAtISO: minutesAgo(150), createdByOperatorId: 'op-rokade' },
            financialSummary: financials(1200),
        },
        // Jadhav — machinery then a spray, both on Sugarcane A. The spray
        // is left unverified (`verification.required: true`) so the header's
        // real "needs your decision" row has something honest to show.
        {
            id: 'log-jadhav-1',
            date: today,
            context: plotContext('crop-sugarcane', 'Sugarcane', 'plot-sugarcane-a', 'Sugarcane A'),
            dayOutcome: 'WORK_RECORDED',
            cropActivities: [],
            irrigation: [],
            labour: [],
            inputs: [],
            machinery: [{ id: 'mach-1', type: 'tractor', ownership: 'owned', rentalCost: 500 }],
            meta: { createdAtISO: minutesAgo(200), createdByOperatorId: 'op-jadhav' },
            financialSummary: financials(0, 0, 500),
        },
        {
            id: 'log-jadhav-2',
            date: today,
            context: plotContext('crop-sugarcane', 'Sugarcane', 'plot-sugarcane-a', 'Sugarcane A'),
            dayOutcome: 'WORK_RECORDED',
            cropActivities: [],
            irrigation: [],
            labour: [],
            inputs: [{ id: 'inp-1', method: 'Spray', mix: [], cost: 350 }],
            machinery: [],
            meta: { createdAtISO: minutesAgo(120), createdByOperatorId: 'op-jadhav' },
            verification: { status: LogVerificationStatus.CONFIRMED, required: true },
            financialSummary: financials(0, 350),
        },
        // Shinde — a crop activity plus an observation note, on Sugarcane B.
        {
            id: 'log-shinde-1',
            date: today,
            context: plotContext('crop-sugarcane', 'Sugarcane', 'plot-sugarcane-b', 'Sugarcane B'),
            dayOutcome: 'WORK_RECORDED',
            cropActivities: [{ id: 'act-1', title: 'Weeding' }],
            irrigation: [],
            labour: [],
            inputs: [],
            machinery: [],
            observations: [{
                id: 'obs-1',
                plotId: 'plot-sugarcane-b',
                dateKey: today,
                timestamp: minutesAgo(60),
                textRaw: 'Weeding done, minor pest seen near the border row.',
                noteType: 'observation',
                severity: 'normal',
                source: 'manual',
            }],
            meta: { createdAtISO: minutesAgo(60), createdByOperatorId: 'op-shinde' },
            financialSummary: financials(),
        },
        // No `meta.createdByOperatorId` — the अज्ञात (unattributed) row.
        {
            id: 'log-unattributed-1',
            date: today,
            context: plotContext('crop-grapes', 'Grapes', 'plot-grapes-a', 'Grapes A'),
            dayOutcome: 'WORK_RECORDED',
            cropActivities: [],
            irrigation: [{ id: 'irr-2', method: 'drip', source: 'well' }],
            labour: [],
            inputs: [],
            machinery: [],
            meta: { createdAtISO: minutesAgo(30) },
            financialSummary: financials(),
        },
        // Control — genuinely old (10 days), proves the header's real
        // unseen-arrival gate is doing real filtering, not just echoing
        // every seed log unconditionally.
        {
            id: 'log-rokade-old',
            date: getDateKeyDaysAgo(10),
            context: plotContext('crop-grapes', 'Grapes', 'plot-grapes-a', 'Grapes A'),
            dayOutcome: 'WORK_RECORDED',
            cropActivities: [],
            irrigation: [],
            labour: [{ id: 'lab-old', type: 'HIRED', count: 2, wagePerPerson: 400 }],
            inputs: [],
            machinery: [],
            meta: { createdAtISO: new Date(nowMs - 10 * 24 * 60 * 60_000).toISOString(), createdByOperatorId: 'op-rokade' },
            financialSummary: financials(800),
        },
    ];
}
