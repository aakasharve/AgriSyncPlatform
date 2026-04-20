/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Work Summary Service
 * 
 * Transforms raw DailyLog data into structured DayWorkSummary for Reflect page.
 * Core principle: Show what happened and why it cost ₹X.
 */

import {
    DailyLog,
    DayWorkSummary,
    LabourSummary,
    IrrigationSummary,
    MachinerySummary,
    InputsSummary,
    InputItem,
    NotesSummary,
    LedgerDefaults,
    FarmOperator
} from '../../types';

const calculateMachineryCost = (fuelCost: number, rentalCost: number): number => fuelCost + rentalCost;
const calculateTotalDayCost = (labourCost: number, inputsCost: number, machineryCost: number): number =>
    labourCost + inputsCost + machineryCost;

const FAILURE_TEXT_PATTERNS = [
    /did\s*not/i,
    /didn['’]?t/i,
    /unable/i,
    /failed/i,
    /\bnahi\b/i,
    /नाही/u
];

const isFailedIrrigationEvent = (event: DailyLog['irrigation'][number], transcriptText?: string): boolean => {
    const issueType = event.issue?.issueType;
    const hasBlockingIssue = issueType === 'MACHINERY'
        || issueType === 'ELECTRICITY'
        || issueType === 'WATER_SOURCE'
        || issueType === 'OTHER';
    const hasZeroDuration = typeof event.durationHours === 'number' && event.durationHours <= 0;
    const combinedText = [
        event.notes,
        event.sourceText,
        event.systemInterpretation,
        event.issue?.reason,
        event.issue?.note,
        transcriptText
    ].filter(Boolean).join(' ');
    const hasFailureText = FAILURE_TEXT_PATTERNS.some(pattern => pattern.test(combinedText));

    return hasFailureText || (hasBlockingIssue && hasZeroDuration);
};

const countSuccessfulIrrigationEvents = (
    events: DailyLog['irrigation'] = [],
    transcriptText?: string
): number => events.filter(event => !isFailedIrrigationEvent(event, transcriptText)).length;

/**
 * Generate comprehensive work summary from daily log
 * This is the bridge between raw data and UI display
 */
export const generateDayWorkSummary = (
    log: DailyLog,
    settings: LedgerDefaults,
    operators?: FarmOperator[]
): DayWorkSummary => {

    try {
        const labourSummary = generateLabourSummary(log, settings);
        const irrigationSummary = generateIrrigationSummary(log);
        const machinerySummary = generateMachinerySummary(log);
        const inputsSummary = generateInputsSummary(log);
        const notesSummary = generateNotesSummary(log);

        // NEW: Activities Summary (Extract unique titles from workTypes)
        const activityTitles = new Set<string>();
        if (log.cropActivities) {
            log.cropActivities.forEach(a => {
                // If it has specific workTypes, use them
                if (a.workTypes && a.workTypes.length > 0) {
                    a.workTypes.forEach(t => activityTitles.add(t));
                }
                // Fallback to title if no workTypes (legacy support)
                else if (a.title && !a.title.startsWith('Log of')) {
                    // Filter out generic placeholders
                    if (a.title !== 'Farm Labour' && a.title !== 'Spraying' && a.title !== 'Irrigation') {
                        activityTitles.add(a.title);
                    }
                }
            });
        }

        const totalCost = calculateTotalDayCost(
            labourSummary.totalCost,
            inputsSummary.totalCost,
            machinerySummary.totalCost
        );

        return {
            date: log.date,
            totalCost,
            activities: {
                titles: Array.from(activityTitles),
                count: log.cropActivities?.length || 0
            },
            labour: labourSummary,
            irrigation: irrigationSummary,
            machinery: machinerySummary,
            inputs: inputsSummary,
            notes: notesSummary.exists ? notesSummary : undefined,
            weather: log.weatherSnapshot,
            // Attribution
            loggedBy: operators?.find(op => op.id === log.meta?.createdByOperatorId)?.name,
            loggedAt: log.meta?.createdAtISO,
            verifiedBy: operators?.find(op => op.id === log.verification?.verifiedByOperatorId)?.name,
            verificationStatus: log.verification?.status
        };
    } catch (error) {
        console.error('Error generating work summary:', error);
        // Return safe empty summary
        return {
            date: log.date,
            totalCost: 0,
            labour: {
                maleCount: 0,
                femaleCount: 0,
                maleRate: 0,
                femaleRate: 0,
                hoursWorked: 0,
                totalCost: 0,
                isEmpty: true,
                events: []
            },
            irrigation: {
                method: 'None',
                durationHours: 0,
                source: '',
                cost: 0,
                occurred: false,
                isEmpty: true,
                events: []
            },
            machinery: {
                machineType: '',
                purpose: '',
                fuelCost: 0,
                rentalCost: 0,
                totalCost: 0,
                isEmpty: true,
                events: []
            },
            inputs: {
                items: [],
                totalCost: 0,
                isEmpty: true
            }
        };
    }
};

/**
 * Extract and aggregate labour data
 * CRITICAL: Rates must come from Settings, not from log entries
 */
const generateLabourSummary = (
    log: DailyLog,
    settings: LedgerDefaults
): LabourSummary => {

    if (!log.labour || log.labour.length === 0) {
        return {
            maleCount: 0,
            femaleCount: 0,
            maleRate: settings.labour.defaultWage,
            femaleRate: settings.labour.defaultWage,
            hoursWorked: 0,
            totalCost: 0,
            isEmpty: true,
            events: []
        };
    }

    // Aggregate across all labour events
    let totalMale = 0;
    let totalFemale = 0;
    let totalCost = 0;
    let maxHours = 0;

    log.labour.forEach(event => {
        totalMale += event.maleCount || 0;
        totalFemale += event.femaleCount || 0;
        totalCost += event.totalCost || 0;

        // Estimate hours from shift or default
        const hours = settings.labour.defaultHours || 8;
        if (hours > maxHours) maxHours = hours;
    });

    // Get rates from settings (use first shift as default, or fallback)
    const defaultShift = settings.labour.shifts[0];
    const maleRate = defaultShift?.defaultRateMale || settings.labour.defaultWage;
    const femaleRate = defaultShift?.defaultRateFemale || settings.labour.defaultWage;

    return {
        maleCount: totalMale,
        femaleCount: totalFemale,
        maleRate,
        femaleRate,
        hoursWorked: maxHours,
        totalCost,
        isEmpty: false,
        events: log.labour
    };
};

/**
 * Extract irrigation data
 * IMPORTANT: Show even if it was "planned/default" irrigation
 */
const generateIrrigationSummary = (log: DailyLog): IrrigationSummary => {

    if (!log.irrigation || log.irrigation.length === 0) {
        return {
            method: 'None',
            durationHours: 0,
            source: '',
            cost: 0,
            occurred: false,
            isEmpty: true,
            events: []
        };
    }

    const successfulEvents = log.irrigation.filter(event => !isFailedIrrigationEvent(event, log.fullTranscript));
    const primaryEvent = successfulEvents[0] || log.irrigation[0];
    let totalDuration = 0;

    successfulEvents.forEach(event => {
        totalDuration += event.durationHours || 0;
    });

    const successfulCount = countSuccessfulIrrigationEvents(log.irrigation, log.fullTranscript);

    return {
        method: primaryEvent.method as any || 'Drip',
        durationHours: totalDuration,
        source: primaryEvent.source || 'Unknown',
        cost: 0, // Usually free (electricity cost tracked separately)
        occurred: successfulCount > 0,
        isEmpty: false,
        events: log.irrigation
    };
};

/**
 * Extract machinery data and calculate costs
 */
const generateMachinerySummary = (log: DailyLog): MachinerySummary => {

    if (!log.machinery || log.machinery.length === 0) {
        return {
            machineType: '',
            purpose: '',
            fuelCost: 0,
            rentalCost: 0,
            totalCost: 0,
            isEmpty: true,
            events: []
        };
    }

    // Aggregate machinery costs
    let totalFuel = 0;
    let totalRental = 0;
    const types: string[] = [];

    log.machinery.forEach(event => {
        totalFuel += event.fuelCost || 0;
        totalRental += event.rentalCost || 0;
        if (event.type) types.push(event.type);
    });

    const machineType = types.length > 1
        ? `${types.length} machines`
        : (types[0] || 'Unknown');

    // Null-safe task access
    const purpose = (log.cropActivities && log.cropActivities.length > 0) ? log.cropActivities[0].title : 'General use';

    return {
        machineType,
        purpose,
        fuelCost: totalFuel,
        rentalCost: totalRental,
        totalCost: calculateMachineryCost(totalFuel, totalRental),
        isEmpty: false,
        events: log.machinery
    };
};

/**
 * Extract inputs and format as bill-like items
 * Human-readable, not chemical jargon
 */
const generateInputsSummary = (log: DailyLog): InputsSummary => {

    if (!log.inputs || log.inputs.length === 0) {
        return {
            items: [],
            totalCost: 0,
            isEmpty: true
        };
    }

    const items: InputItem[] = [];
    let totalCost = 0;

    log.inputs.forEach(inputEvent => {
        // Handle new mix-based format
        if (inputEvent.mix && inputEvent.mix.length > 0) {
            inputEvent.mix.forEach(mixItem => {
                items.push({
                    name: mixItem.productName,
                    quantity: mixItem.dose ?? 0,
                    unit: mixItem.unit,
                    applicationMethod: inputEvent.method || 'Unknown',
                    individualCost: inputEvent.cost ? (inputEvent.cost / inputEvent.mix.length) : 0,
                    inputType: inputEvent.type || 'unknown'
                });
            });
            totalCost += inputEvent.cost || 0;
        }
        // Fallback to legacy format
        else if (inputEvent.productName) {
            items.push({
                name: inputEvent.productName,
                quantity: inputEvent.quantity || 0,
                unit: inputEvent.unit || '',
                applicationMethod: inputEvent.method || 'Unknown',
                individualCost: inputEvent.cost || 0,
                inputType: inputEvent.type || 'unknown'
            });
            totalCost += inputEvent.cost || 0;
        }
    });

    return {
        items,
        totalCost,
        isEmpty: items.length === 0
    };
};

/**
 * Extract notes/remarks if present
 */
const generateNotesSummary = (log: DailyLog): NotesSummary => {

    // Collect notes from various sources
    const notes: string[] = [];

    // Task notes (null-safe)
    if (log.cropActivities && log.cropActivities.length > 0) {
        log.cropActivities.forEach(activity => {
            if (activity.notes) notes.push(activity.notes);
        });
    }

    // Disturbance notes
    if (log.disturbance?.note) {
        notes.push(`Disturbance: ${log.disturbance.note}`);
    }

    // General observations
    if (log.irrigation && log.irrigation.length > 0) {
        log.irrigation.forEach(irr => {
            if (irr.notes) notes.push(irr.notes);
        });
    }

    const content = notes.join(' | ');

    return {
        content,
        exists: content.length > 0
    };
};
