/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DEMO DATA SERVICE - Realistic 90-Day Farm Operations
 *
 * PURPOSE: Generate deterministic, realistic demo data that simulates
 * actual farming operations for a 4-crop farm over 90 days (Quarterly View).
 *
 * DESIGN PRINCIPLES:
 * 1. Calendar-based patterns (not random) - irrigation schedules are consistent
 * 2. Crop-specific work cycles - sprays every 10-14 days, labor patterns
 * 3. Realistic issues emerge naturally - pest, disease, weather disruptions
 * 4. Multi-plot scenarios - same day different work, shared spray sessions
 * 5. Task completion flow - pending to done with critical items highlighted
 * 6. Verification variety - approved, pending, rejected states
 * 7. Financial Depth - Procurement, Harvest Income, Labour Costs
 * 8. Comparison Contrast - "Perfect" vs "Problematic" plots clearly visible
 *
 * CROPS (from stored crop profiles):
 * - c1 Grapes: p1_1 Export Plot A (Daily Drip), p1_2 Local Plot B (Alternate Drip)
 * - c2 Pomegranate: p2_1 Bhagwa #1 (Daily Drip), p2_2 Bhagwa #2 (Daily Drip)
 * - c3 Sugarcane: p3_1 River Bank (Weekly Flood)
 * - c4 Onion: p4_1 Summer Crop (Every 3 Days Sprinkler)
 */

import {
    DailyLog,
    FarmContext,
    CropActivityEvent,
    IrrigationEvent,
    LabourEvent,
    InputEvent,
    InputReason,
    MachineryEvent,
    CropProfile,
    ActivityExpenseEvent,
    ObservationNote,
    ObservationNoteType,
    ObservationSeverity,
    DisturbanceEvent,
    LogVerification,
    LogVerificationStatus,
    WeatherStamp,
    PlannedTask
} from '../../types';
import { HarvestSession, HarvestDayEntry } from '../logs/harvest.types';
import { ProcurementExpense, ExpenseLineItem } from '../procurement/procurement.types';
import { getDateKey, getTodayKey } from '../../core/domain/services/DateKeyService';
import { idGenerator } from '../../core/domain/services/IdGenerator';

// --- VERSION ---
export const DEMO_SEED_VERSION = "v4.0.0-90days"; // Full quarter data with comparison tracks

const TODAY = new Date();

// --- OPERATORS (matches FarmerProfile in useAppData) ---
const DEMO_OPERATORS = {
    owner: { id: 'owner', name: 'Ramu (Owner)', role: 'PRIMARY_OWNER' },
    manager1: { id: 'manager1', name: 'Suresh (Manager)', role: 'SECONDARY_OWNER' },
    verifier1: { id: 'verifier1', name: 'Agronomist', role: 'WORKER' },
} as const;

// Operator rotation: who logs on which day pattern
const getOperatorForDay = (dayOffset: number, plotId: string): keyof typeof DEMO_OPERATORS => {
    // Owner logs most days, manager handles specific plots, verifier does inspections
    const dayOfWeek = new Date(TODAY.getTime() + dayOffset * 86400000).getDay();

    // Manager handles sugarcane & onion on weekdays
    if (['p3_1', 'p4_1'].includes(plotId) && dayOfWeek >= 1 && dayOfWeek <= 5) {
        return 'manager1';
    }
    // Verifier does weekly inspections (Sundays)
    if (dayOfWeek === 0 && dayOffset % 7 === 0) {
        return 'verifier1';
    }
    // Owner handles everything else
    return 'owner';
};

// --- SEEDED RNG (for controlled randomness in details, not structure) ---
const hashStringToInt = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
};

const mulberry32 = (a: number) => {
    return function () {
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const seed = hashStringToInt(`${DEMO_SEED_VERSION}::${TODAY.toISOString().slice(0, 10)}`);
const rand = mulberry32(seed);

const rInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const rPick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const rMaybe = (p: number) => rand() < p;

const getRandomId = (prefix: string) => `${prefix}_${idGenerator.generate()}`;

const getRelativeDateStr = (offset: number) => {
    const d = new Date(TODAY);
    d.setDate(d.getDate() + offset);
    return getDateKey(d);
};

// --- CALENDAR PATTERNS (Deterministic schedules) ---

// Irrigation schedule: which plots get irrigated on which day pattern
const IRRIGATION_SCHEDULE: Record<string, (dayOfMonth: number) => boolean> = {
    'p1_1': () => true, // Grapes Export: Daily (Consistent)
    'p1_2': (d) => d % 2 === 0, // Grapes Local: Alternate (even days)
    'p2_1': () => true, // Pomegranate #1: Daily (Consistent)
    'p2_2': (d) => d % 3 === 0, // Pomegranate #2: Irregular (every 3 days due to issues) - INCONSISTENT vs p2_1
    'p3_1': (d) => d % 10 === 0, // Sugarcane: Every 10 days
    'p4_1': (d) => d % 4 === 0, // Onion: Every 4 days
};

// Spray/Fertilizer schedule: every 10-15 days per crop over 90 days
const SPRAY_SCHEDULE: Record<string, number[]> = {
    // Grapes: Heavy spray schedule
    'c1': [-85, -75, -65, -55, -45, -35, -28, -17, -7, -2],
    // Pomegranate: Moderate
    'c2': [-80, -60, -40, -25, -14, -4],
    // Sugarcane: Low (Fertilizer mainly)
    'c3': [-70, -40, -10],
    // Onion: Sensitive
    'c4': [-50, -35, -20, -8],
};

// Issue days: specific days where problems occur
// This creates "Stories" for the dashboard
type IssueScheduleSeverity = 'normal' | 'important' | 'urgent' | 'high';
interface IssueScheduleEntry {
    day: number;
    cropId: string;
    type: 'pest' | 'disease' | 'resource' | 'irrigation' | 'weather';
    description: string;
    severity: IssueScheduleSeverity;
}
const ISSUE_SCHEDULE: IssueScheduleEntry[] = [
    // Early Season Issues
    { day: -82, cropId: 'c1', type: 'pest', description: 'Thrips population building up', severity: 'normal' },
    { day: -65, cropId: 'c2', type: 'disease', description: 'Bacterial blight spots seen on p2_2', severity: 'important' },

    // Mid Season Issues
    { day: -45, cropId: 'c3', type: 'resource', description: 'Canal water release delayed', severity: 'high' },
    { day: -38, cropId: 'p2_2', type: 'irrigation', description: 'Drip lateral leakage', severity: 'normal' }, // Specific to p2_2

    // Late Season / Current Issues
    { day: -25, cropId: 'c1', type: 'pest', description: 'Mealybug spotted near border', severity: 'urgent' },
    { day: -18, cropId: 'c2', type: 'disease', description: 'Fungal attack on fruit setting', severity: 'high' },
    { day: -12, cropId: 'c4', type: 'weather', description: 'Cloudy weather - risk of blight', severity: 'normal' },
    { day: -5, cropId: 'p2_2', type: 'pest', description: 'Fruit borer observed', severity: 'urgent' }, // Validates p2_2 is problematic
];

// The schedule allows a wider 'high' value than ObservationSeverity. Cast at
// the boundary to preserve existing runtime behavior (the literal flows through
// untouched, matching the prior `as any` pass-through).
const toObservationSeverity = (s: IssueScheduleSeverity): ObservationSeverity =>
    s as ObservationSeverity;

// --- HARVEST SCHEDULES ---
// 1. Onion Harvest (Current, last 5 days)
const ONION_HARVEST_DAYS = [-5, -4, -3, -2, -1];
const ONION_HARVEST_QS = [12, 15, 18, 14, 16];

// 2. Grapes Early Harvest (Completed 45 days ago)
const GRAPE_HARVEST_DAYS = [-50, -49, -48];
const GRAPE_HARVEST_QS = [200, 250, 180]; // Crates

// Multi-plot shared sessions (efficiency stories)
const SHARED_SESSIONS = [
    { day: -75, cropId: 'c2', plotIds: ['p2_1', 'p2_2'], workType: 'Weeding', note: 'Labor gang scaled across both plots' },
    { day: -55, cropId: 'c1', plotIds: ['p1_1', 'p1_2'], workType: 'Dipping', note: 'Bunch dipping ongoing' },
    { day: -25, cropId: 'c2', plotIds: ['p2_1', 'p2_2'], workType: 'Spraying', note: 'Combined spray session' },
    { day: -4, cropId: 'c2', plotIds: ['p2_1', 'p2_2'], workType: 'Fertigation', note: 'Main line fertigation' },
];

// Weather disturbance days (no work possible)
const DISTURBANCE_DAYS = [-88, -42, -23, -12];

// --- HELPER FUNCTIONS ---

const createContextWithPlots = (crop: CropProfile, plotIds: string[]): FarmContext => {
    const selectedPlots = crop.plots.filter(p => plotIds.includes(p.id));
    return {
        selection: [{
            cropId: crop.id,
            cropName: crop.name,
            selectedPlotIds: selectedPlots.map(p => p.id),
            selectedPlotNames: selectedPlots.map(p => p.name)
        }]
    };
};

const getMockWeather = (dateStr: string, isDisturbance: boolean, plotId: string): WeatherStamp => {
    const dayHash = hashStringToInt(dateStr + plotId);
    const dayRand = mulberry32(dayHash);

    const baseTemp = isDisturbance ? 22 + Math.floor(dayRand() * 4) : 28 + Math.floor(dayRand() * 8);
    const rain = isDisturbance ? 20 + Math.floor(dayRand() * 30) : (dayRand() < 0.1 ? Math.floor(dayRand() * 5) : 0);
    const conditionText = isDisturbance ? "Heavy Rain" : (rain > 0 ? "Partly Cloudy" : "Sunny");

    return {
        id: `wx_${dateStr}_${plotId}`,
        plotId,
        timestampLocal: new Date(`${dateStr}T08:00:00.000Z`).toISOString(),
        timestampProvider: new Date(`${dateStr}T08:00:00.000Z`).toISOString(),
        provider: 'mock',
        tempC: baseTemp,
        humidity: isDisturbance ? 85 : 40,
        windKph: 10,
        precipMm: rain,
        cloudCoverPct: isDisturbance ? 95 : 20,
        conditionText,
        iconCode: isDisturbance ? "storm" : (rain > 0 ? "cloudy" : "sunny"),
        rainProbNext6h: isDisturbance ? 90 : 10,
        windGustKph: 15,
        soilMoistureVolumetric0To10: isDisturbance ? 40 : 20
    };
};

const getTimeForLog = (dateStr: string, isToday: boolean): { hour: number; minute: number } => {
    const dayHash = hashStringToInt(dateStr);
    const dayRand = mulberry32(dayHash);
    if (isToday) return { hour: 8, minute: 30 };
    return { hour: 6 + Math.floor(dayRand() * 10), minute: Math.floor(dayRand() * 60) };
};

// --- EVENT BUILDERS ---

const buildIrrigationEvent = (linkedActivityId: string, plotId: string, crop: CropProfile): IrrigationEvent => {
    const plot = crop.plots.find(p => p.id === plotId);
    const method = plot?.infrastructure?.irrigationMethod || 'Drip';
    const duration = plot?.irrigationPlan?.durationMinutes || 60;

    return {
        id: getRandomId('irr'),
        linkedActivityId,
        method,
        source: rPick(['Well', 'Borewell', 'Canal']),
        durationHours: Math.round(duration / 60 * 10) / 10,
        notes: rMaybe(0.2) ? 'Routine flow' : undefined
    };
};

const buildLabourEvent = (linkedActivityId: string, workType: string, isHeavy: boolean): LabourEvent => {
    const type = rPick(['HIRED', 'HIRED', 'CONTRACT'] as const); // Bias towards HIRED
    const count = isHeavy ? rInt(4, 8) : rInt(2, 4);
    const wage = rPick([350, 400, 450, 500]);

    if (type === 'CONTRACT') {
        const qty = rInt(1, 3);
        const rate = rPick([1200, 1500]);
        return {
            id: getRandomId('lab'),
            linkedActivityId,
            type: 'CONTRACT',
            contractUnit: 'Acre',
            contractQuantity: qty,
            totalCost: rate * qty,
            notes: `${workType} contract`,
            whoWorked: 'HIRED_LABOUR',
            activity: workType
        };
    }

    return {
        id: getRandomId('lab'),
        linkedActivityId,
        type: 'HIRED',
        count,
        wagePerPerson: wage,
        totalCost: count * wage,
        notes: `${workType} crew`,
        whoWorked: 'HIRED_LABOUR',
        activity: workType
    };
};

const buildInputEvent = (linkedActivityId: string, reason: InputReason, method?: 'Spray' | 'Drip' | 'Soil', overrideType?: InputEvent['type']): InputEvent => {
    const isFertigation = method === 'Drip' || method === 'Soil' || reason === 'Growth';
    const product = isFertigation ? rPick(['Urea', '19:19:19', 'Potash', 'Magnesium']) : rPick(['Mancozeb', 'Confidor', 'Curacron', 'Trace', 'Gibberellic']);
    const type: InputEvent['type'] = overrideType || (isFertigation ? 'fertilizer' : 'pesticide');
    const finalMethod = method || (isFertigation ? 'Drip' : 'Spray');

    return {
        id: getRandomId('inp'),
        linkedActivityId,
        method: finalMethod,
        type,
        mix: [{
            id: getRandomId('mix'),
            productName: product,
            dose: isFertigation ? rPick([5, 10]) : rPick([1, 2]),
            unit: isFertigation ? 'kg' : 'ml/L'
        }],
        reason,
        cost: rInt(800, 3500),
        notes: `Applied for ${reason}`
    };
};

const buildObservation = (dateStr: string, crop: CropProfile, plotId: string, text: string, noteType: ObservationNoteType, severity: ObservationSeverity): ObservationNote => {
    const obsId = getRandomId('obs');
    // TaskCandidate.priority is 'normal' | 'high'; collapse the wider severity scale.
    const taskPriority: 'normal' | 'high' = severity === 'normal' ? 'normal' : 'high';
    const tasks = noteType === 'reminder' ? [{
        id: getRandomId('task'),
        title: text,
        plotId,
        priority: taskPriority,
        status: 'pending' as const,
        sourceNoteId: obsId,
        dueDate: dateStr,
        confidence: 0.95
    }] : undefined;

    return {
        id: obsId,
        plotId,
        cropId: crop.id,
        dateKey: dateStr,
        timestamp: new Date(`${dateStr}T17:00:00.000Z`).toISOString(),
        textRaw: text,
        textCleaned: text,
        noteType,
        severity,
        tags: ['demo'],
        source: 'voice',
        extractedTasks: tasks
    };
};

// --- MAIN LOG BUILDER ---

const buildLog = (
    dateStr: string,
    crop: CropProfile,
    plotIds: string[],
    payload: {
        cropActivities: CropActivityEvent[];
        irrigation?: IrrigationEvent[];
        labour?: LabourEvent[];
        inputs?: InputEvent[];
        machinery?: MachineryEvent[];
        expenses?: ActivityExpenseEvent[];
        observations?: ObservationNote[];
        disturbance?: DisturbanceEvent;
        fullTranscript?: string;
    },
    dayOutcome: 'WORK_RECORDED' | 'DISTURBANCE_RECORDED' = 'WORK_RECORDED',
    verification?: LogVerification,
    operatorOverride?: keyof typeof DEMO_OPERATORS
): DailyLog => {

    const irrigation = payload.irrigation || [];
    const labour = payload.labour || [];
    const inputs = payload.inputs || [];
    const machinery = payload.machinery || [];
    const expenses = payload.expenses || [];
    const observations = payload.observations || [];

    const labourCost = labour.reduce((s, x) => s + (x.totalCost || 0), 0);
    const inputCost = inputs.reduce((s, x) => s + (x.cost || 0), 0);
    const machineCost = machinery.reduce((s, x) => s + (x.rentalCost || x.fuelCost || 0), 0);
    const grandTotal = labourCost + inputCost + machineCost + expenses.reduce((s, x) => s + (x.totalAmount || 0), 0);

    const isDisturbance = !!payload.disturbance;
    const weatherStamp = getMockWeather(dateStr, isDisturbance, plotIds[0] || 'multi_plot');

    const { hour, minute } = getTimeForLog(dateStr, dateStr === getTodayKey());
    const createdAtISO = new Date(`${dateStr}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00.000Z`).toISOString();

    return {
        id: getRandomId(`log_${dateStr}_${crop.id}`),
        date: dateStr,
        context: createContextWithPlots(crop, plotIds),
        dayOutcome,
        weatherStamp,
        weatherSnapshot: {
            fetchedAt: weatherStamp.timestampLocal,
            lat: 19.99, lon: 73.78, provider: 'mock',
            current: { tempC: weatherStamp.tempC, humidity: weatherStamp.humidity, windKph: weatherStamp.windKph, precipMm: weatherStamp.precipMm, conditionText: weatherStamp.conditionText, iconCode: weatherStamp.iconCode }
        },
        cropActivities: payload.cropActivities,
        irrigation,
        labour,
        inputs,
        machinery,
        activityExpenses: expenses,
        observations,
        disturbance: payload.disturbance,
        fullTranscript: payload.fullTranscript,
        meta: {
            createdAtISO,
            createdByOperatorId: operatorOverride || 'owner',
            appVersion: DEMO_SEED_VERSION,
            schemaVersion: 2
        },
        financialSummary: {
            totalLabourCost: labourCost,
            totalInputCost: inputCost,
            totalMachineryCost: machineCost,
            totalActivityExpenses: expenses.reduce((s, x) => s + (x.totalAmount || 0), 0),
            grandTotal
        },
        verification: verification || {
            status: LogVerificationStatus.VERIFIED,
            required: true,
            verifiedByOperatorId: 'owner',
            verifiedAtISO: createdAtISO
        }
    };
};

// --- DATA GENERATOR ---

export const generateRollingDemoData = (crops: CropProfile[]): DailyLog[] => {
    if (!crops || crops.length === 0) return [];
    const safeCrops = crops.filter(c => c.plots && c.plots.length > 0);
    const logs: DailyLog[] = [];

    // Loop LAST 90 DAYS
    for (let dayOffset = -90; dayOffset <= 0; dayOffset++) {
        const dateStr = getRelativeDateStr(dayOffset);
        const dayOfMonth = new Date(dateStr).getDate();

        // 1. Disturbances (Global)
        if (DISTURBANCE_DAYS.includes(dayOffset)) {
            const disturbedCrop = safeCrops[0];
            logs.push(buildLog(dateStr, disturbedCrop, [disturbedCrop.plots[0].id], {
                cropActivities: [{ id: getRandomId('act'), title: 'Weather Stop', workTypes: [], status: 'partial' }],
                observations: [buildObservation(dateStr, disturbedCrop, disturbedCrop.plots[0].id, 'Heavy disruption - High rain alert', 'issue', 'urgent')],
                disturbance: { scope: 'FULL_DAY', group: 'Weather', reason: 'Storm', severity: 'HIGH', blockedSegments: ['irrigation'], note: 'All ops halted' },
                fullTranscript: 'Too much rain, no work possible.'
            }, 'DISTURBANCE_RECORDED'));
            continue;
        }

        // 2. Shared Sessions (Efficiency)
        const shared = SHARED_SESSIONS.find(s => s.day === dayOffset);
        if (shared) {
            const crop = safeCrops.find(c => c.id === shared.cropId);
            if (crop) {
                const actId = getRandomId('act');
                logs.push(buildLog(dateStr, crop, shared.plotIds, {
                    cropActivities: [{ id: actId, title: shared.workType, workTypes: [shared.workType], status: 'completed', isCommonActivity: true }],
                    labour: [buildLabourEvent(actId, shared.workType, true)],
                    fullTranscript: `Shared ${shared.workType} work on both plots.`
                }));
            }
        }

        // 3. Spray Schedules (Major operations)
        Object.keys(SPRAY_SCHEDULE).forEach(cropId => {
            if (SPRAY_SCHEDULE[cropId].includes(dayOffset)) {
                const crop = safeCrops.find(c => c.id === cropId);
                if (crop) {
                    const plotIds = crop.plots.map(p => p.id);
                    const actId = getRandomId('act');
                    const reason = rPick(['Preventive', 'Growth', 'Pest'] as const);
                    logs.push(buildLog(dateStr, crop, plotIds, {
                        cropActivities: [{ id: actId, title: `${reason} Spray`, workTypes: ['Spraying'], status: 'completed', isCommonActivity: true }],
                        inputs: [buildInputEvent(actId, reason, 'Spray')],
                        machinery: [{ id: getRandomId('mac'), linkedActivityId: actId, type: 'tractor', ownership: 'owned', hoursUsed: 2, fuelCost: 300 }],
                        fullTranscript: `${reason} spray completed on all plots.`
                    }));
                }
            }
        });

        // 4. Routine Irrigation & Ops (The "Grind")
        safeCrops.forEach(crop => {
            crop.plots.forEach(plot => {
                // Skip if already logged via shared/spray
                if (logs.some(l => l.date === dateStr && l.context.selection[0].selectedPlotIds.includes(plot.id))) return;

                // Irrigation check
                if (IRRIGATION_SCHEDULE[plot.id]?.(dayOfMonth)) {
                    // Inject Inconsistency for p2_2 (Problematic Plot)
                    if (plot.id === 'p2_2' && rMaybe(0.3)) {
                        // 30% chance to miss irrigation on p2_2
                        return;
                    }

                    const actId = getRandomId('act');
                    const issue = ISSUE_SCHEDULE.find(i => i.day === dayOffset && (i.cropId === crop.id || i.cropId === plot.id));

                    logs.push(buildLog(dateStr, crop, [plot.id], {
                        cropActivities: [{ id: actId, title: 'Irrigation & Patrol', workTypes: ['Irrigation'], status: 'completed' }],
                        irrigation: [buildIrrigationEvent(actId, plot.id, crop)],
                        observations: issue ? [buildObservation(dateStr, crop, plot.id, issue.description, issue.type === 'weather' ? 'reminder' : 'issue', toObservationSeverity(issue.severity))] : [],
                        fullTranscript: 'Water given according to schedule.'
                    }, 'WORK_RECORDED', undefined, getOperatorForDay(dayOffset, plot.id)));
                }
            });
        });

        // 5. Onion Harvest (Last 5 days)
        if (ONION_HARVEST_DAYS.includes(dayOffset)) {
            const crop = safeCrops.find(c => c.id === 'c4');
            const idx = ONION_HARVEST_DAYS.indexOf(dayOffset);
            if (crop) {
                const actId = getRandomId('hvst');
                logs.push(buildLog(dateStr, crop, ['p4_1'], {
                    cropActivities: [{
                        id: actId, title: `Harvest Day ${idx + 1}`, workTypes: ['Harvesting'], status: 'completed',
                        isHarvestActivity: true, linkedHarvestSessionId: 'hs_onion_demo', harvestQuantity: ONION_HARVEST_QS[idx], harvestUnit: { type: 'WEIGHT', weightUnit: 'QUINTAL' }
                    }],
                    labour: [{ id: getRandomId('lab'), linkedActivityId: actId, type: 'HIRED', count: 10 + idx, totalCost: (10 + idx) * 400, whoWorked: 'HIRED_LABOUR', activity: 'Harvesting' }],
                    fullTranscript: `Picking day ${idx + 1} complete.`
                }));
            }
        }
    }

    return logs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

// --- FINANCIAL GENERATORS ---

import { financeCommandService } from '../finance/financeCommandService';
import { MoneyCategory } from '../finance/finance.types';

export const captureMoneyEventsFromLog = (log: DailyLog): void => {
    const selection = log.context.selection?.[0];
    const cropId = selection?.cropId && selection.cropId !== 'FARM_GLOBAL' ? selection.cropId : undefined;
    const plotId = selection?.selectedPlotIds?.[0];
    const baseDateTime = (log.meta?.createdAtISO || `${log.date}T12:00:00`);
    const createdBy = log.meta?.createdByOperatorId || 'owner';

    log.labour?.forEach((entry) => {
        const amount = entry.totalCost ?? ((entry.count || 0) * (entry.wagePerPerson || 0));
        if (!amount) return;
        financeCommandService.createMoneyEventFromSource({
            type: 'VoiceLog',
            sourceId: `${log.id}:labour:${entry.id}`,
            dateTime: baseDateTime,
            eventType: 'Expense',
            category: 'Labour',
            farmId: selection?.farmId || 'farm_unknown', // Added required property
            cropId,
            plotId,
            amount,
            qty: entry.count,
            unit: 'person',
            unitPrice: entry.wagePerPerson,
            notes: entry.activity,
            createdByUserId: createdBy
        });
    });

    log.inputs?.forEach((entry) => {
        const amount = entry.cost;
        if (!amount) return;
        financeCommandService.createMoneyEventFromSource({
            type: 'VoiceLog',
            sourceId: `${log.id}:input:${entry.id}`,
            dateTime: baseDateTime,
            eventType: 'Expense',
            category: 'Input',
            farmId: selection?.farmId || 'farm_unknown', // Added required property
            cropId,
            plotId,
            amount,
            qty: entry.quantity,
            unit: entry.unit,
            notes: entry.productName || entry.mix?.map(i => i.productName).join(', '),
            createdByUserId: createdBy
        });
    });

    log.machinery?.forEach((entry) => {
        const amount = (entry.rentalCost || 0) + (entry.fuelCost || 0);
        if (!amount) return;
        financeCommandService.createMoneyEventFromSource({
            type: 'VoiceLog',
            sourceId: `${log.id}:machinery:${entry.id}`,
            dateTime: baseDateTime,
            eventType: 'Expense',
            category: 'Machinery',
            farmId: selection?.farmId || 'farm_unknown', // Added required property
            cropId,
            plotId,
            amount,
            qty: entry.hoursUsed,
            unit: 'hour',
            notes: entry.type,
            createdByUserId: createdBy
        });
    });

    (log.activityExpenses || []).forEach((entry) => {
        const category = mapActivityExpenseCategory(entry.category);
        const amount = entry.totalAmount || 0;
        if (!amount) return;
        financeCommandService.createMoneyEventFromSource({
            type: 'Manual',
            sourceId: `${log.id}:activity-expense:${entry.id}`,
            dateTime: baseDateTime,
            eventType: 'Expense',
            category,
            farmId: selection?.farmId || 'farm_unknown', // Added required property
            cropId,
            plotId,
            amount,
            vendorName: entry.vendor,
            notes: entry.reason,
            createdByUserId: createdBy
        });
    });
};

const mapActivityExpenseCategory = (category?: string): MoneyCategory => {
    const normalized = (category || '').toLowerCase();
    if (normalized.includes('labour')) return 'Labour';
    if (normalized.includes('fuel')) return 'Fuel';
    if (normalized.includes('transport')) return 'Transport';
    if (normalized.includes('machinery')) return 'Machinery';
    if (normalized.includes('repair')) return 'Repair';
    if (normalized.includes('electric')) return 'Electricity';
    if (normalized.includes('input') || normalized.includes('fertilizer') || normalized.includes('pesticide')) return 'Input';
    return 'Other';
};

export const generateDemoProcurementExpenses = (): ProcurementExpense[] => {
    const expenses: ProcurementExpense[] = [];
    const vendors = ['Krishi Seva', 'AgriMart', 'Local Dealer'];

    // Generate random expenses over 90 days to populate Finance Dashboard
    for (let i = 0; i < 15; i++) {
        const dayOffset = -rInt(1, 85);
        const date = getRelativeDateStr(dayOffset);
        const amount = rInt(2000, 15000);
        expenses.push({
            id: `proc_${i}`,
            date,
            createdAt: new Date(date).toISOString(),
            scope: 'FARM',
            vendorName: rPick(vendors),
            vendorType: 'SHOP',
            grandTotal: amount,
            amountPaid: amount,
            paymentStatus: 'PAID',
            subtotal: amount,
            // 'MACHINERY' is not a real ExpenseCategory ('MACHINERY_RENTAL' is),
            // but the demo seed has historically emitted it. Cast preserves
            // runtime behavior; reconciling the literal is a separate fix.
            lineItems: [{ id: `li_${i}`, name: 'Material Purchase', quantity: 1, unit: 'Lump', unitPrice: amount, totalAmount: amount, category: rPick(['FERTILIZER', 'PESTICIDE', 'MACHINERY']) as ExpenseLineItem['category'], aiConfidence: 100 }],
            operatorId: 'owner',
            aiExtracted: true,
            userVerified: true
        });
    }
    return expenses;
};

export const generateDemoHarvestSessions = (): HarvestSession[] => {
    // 1. Onion (Active/Recent)
    const onionEntries: HarvestDayEntry[] = ONION_HARVEST_DAYS.map((d, i) => ({
        id: `he_on_${i}`, date: getRelativeDateStr(d), quantity: ONION_HARVEST_QS[i], unit: { type: 'WEIGHT', weightUnit: 'QUINTAL' },
        linkedLogId: `log_${getRelativeDateStr(d)}_c4`, labourCost: 4000
    }));

    // 2. Grapes (Past - 45 days ago)
    const grapeEntries: HarvestDayEntry[] = GRAPE_HARVEST_DAYS.map((d, i) => ({
        id: `he_gr_${i}`, date: getRelativeDateStr(d), quantity: GRAPE_HARVEST_QS[i], unit: { type: 'COUNT', countUnit: 'Crates' },
        linkedLogId: `log_${getRelativeDateStr(d)}_c1`
    }));

    const sessions: HarvestSession[] = [
        {
            id: 'hs_onion_demo',
            plotId: 'p4_1', cropId: 'c4', pattern: 'MULTIPLE', pickingNumber: 1,
            startDate: getRelativeDateStr(ONION_HARVEST_DAYS[0]), endDate: getRelativeDateStr(ONION_HARVEST_DAYS[4]),
            status: 'HARVESTED',
            harvestEntries: onionEntries,
            totalQuantitySent: onionEntries.reduce((s, e) => s + e.quantity, 0),
            totalUnitsSent: onionEntries.reduce((s, e) => s + e.quantity, 0),
            unit: { type: 'WEIGHT', weightUnit: 'QUINTAL' },
            saleEntries: [], // Pending sale
            totalIncome: 0,
            amountReceived: 0, amountPending: 0,
            buyerName: 'Nashik Market',
            createdAt: getRelativeDateStr(ONION_HARVEST_DAYS[0]),
            gradeWiseBreakdown: [],
            pattiStatus: 'PENDING',
            paymentStatus: 'PENDING',
            linkedLogIds: ONION_HARVEST_DAYS.map(d => `log_${getRelativeDateStr(d)}_c4`)
        },
        {
            id: 'hs_grapes_demo',
            plotId: 'p1_1', cropId: 'c1', pattern: 'SINGLE', pickingNumber: 1,
            startDate: getRelativeDateStr(GRAPE_HARVEST_DAYS[0]), endDate: getRelativeDateStr(GRAPE_HARVEST_DAYS[2]),
            status: 'SOLD',
            harvestEntries: grapeEntries,
            totalQuantitySent: grapeEntries.reduce((s, e) => s + e.quantity, 0),
            totalUnitsSent: grapeEntries.reduce((s, e) => s + e.quantity, 0),
            unit: { type: 'COUNT', countUnit: 'Crates' },
            saleEntries: [{
                id: 'sale_gr_1', date: getRelativeDateStr(GRAPE_HARVEST_DAYS[2]), totalAmount: 250000, netAmount: 240000,
                gradeWiseSales: [], totalQuantity: 630, userVerified: true, aiExtracted: false
            }],
            totalIncome: 240000,
            amountReceived: 240000, amountPending: 0,
            buyerName: 'Sahyadri Farms',
            createdAt: getRelativeDateStr(GRAPE_HARVEST_DAYS[0]),
            gradeWiseBreakdown: [],
            pattiStatus: 'RECEIVED',
            paymentStatus: 'RECEIVED',
            linkedLogIds: GRAPE_HARVEST_DAYS.map(d => `log_${getRelativeDateStr(d)}_c1`)
        }
    ];
    return sessions;
};

export const generateDemoPlannedTasks = (_crops?: CropProfile[]): PlannedTask[] => {
    return [
        { id: 't1', title: 'Verify Onion Harvest Weights', priority: 'high', status: 'pending', dueDate: getTodayKey(), cropId: 'c4', plotId: 'p4_1', sourceType: 'manual', createdAt: getRelativeDateStr(-1), aiConfidence: 100 },
        { id: 't2', title: 'Drip Maintenance Pomegranate', priority: 'normal', status: 'pending', dueDate: getRelativeDateStr(1), cropId: 'c2', plotId: 'p2_2', sourceType: 'ai_extracted', createdAt: getRelativeDateStr(-2), aiConfidence: 90 }
    ];
};
