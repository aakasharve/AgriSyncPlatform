/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { Plot, CropPhase } from "../../types";

export interface PhaseResult {
    phase: CropPhase;
    day: number | null;
    label: string;
    effectiveDay?: number | null; // NEW
    lossDays?: number; // NEW
}

// Helper to normalize any date input to Local Noon.
// This prevents timezone offsets (UTC midnight becoming previous day local)
// and DST boundaries from affecting full-day difference calculations.
const toLocalNoon = (dateInput: Date | string): Date => {
    // If string matches YYYY-MM-DD, manually construct to avoid UTC parsing
    if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
        const [y, m, d] = dateInput.split('-').map(Number);
        return new Date(y, m - 1, d, 12, 0, 0);
    }

    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return new Date(); // Fallback to now

    const copy = new Date(d);
    copy.setHours(12, 0, 0, 0);
    return copy;
};

const getDaysDiff = (d1: Date, d2: Date) => {
    const t1 = d1.getTime();
    const t2 = d2.getTime();
    const diff = Math.abs(t2 - t1);
    // Rounding handles minor millisecond drifts
    return Math.round(diff / (1000 * 60 * 60 * 24));
};

export const getPhaseAndDay = (plot?: Plot, targetDate: Date | string = new Date()): PhaseResult => {
    if (!plot) {
        return { phase: 'CROP_CYCLE', day: null, label: 'No Context' };
    }

    const todayNoon = toLocalNoon(targetDate);
    const cycleStartNoon = plot.startDate ? toLocalNoon(plot.startDate) : null;

    // 1. Resolve Prep Start (P0)
    let prepStartNoon: Date | null = null;

    if (plot.landPrep?.startedAt) {
        prepStartNoon = toLocalNoon(plot.landPrep.startedAt);
    } else if (plot.createdAt && cycleStartNoon) {
        // Fallback to createdAt if it's before the cycle start
        const createdNoon = toLocalNoon(plot.createdAt);
        if (createdNoon < cycleStartNoon) {
            prepStartNoon = createdNoon;
        }
    }

    // 2. Logic

    // SCENARIO A: We are in Crop Cycle (Today is AFTER or EQUAL to Start Date)
    if (cycleStartNoon && todayNoon >= cycleStartNoon) {
        const dayNum = getDaysDiff(cycleStartNoon, todayNoon) + 1;
        return {
            phase: 'CROP_CYCLE',
            day: dayNum,
            label: `Day ${dayNum}`
        };
    }

    // SCENARIO B: We are in Land Prep (Today is BEFORE Start Date but AFTER Prep Start)
    if (prepStartNoon && todayNoon >= prepStartNoon) {
        const dayNum = getDaysDiff(prepStartNoon, todayNoon) + 1;
        return {
            phase: 'LAND_PREPARATION',
            day: dayNum,
            label: `Land Prep Day ${dayNum}`
        };
    }

    // SCENARIO C: Unknown Prep / Future or Late Onboarding without Backdated Prep
    // If we are before cycle start but have no prep start date:
    return {
        phase: 'LAND_PREPARATION',
        day: null,
        label: 'Land Prep'
    };
    // SCENARIO C: Unknown Prep / Future or Late Onboarding without Backdated Prep
    // If we are before cycle start but have no prep start date:
    return {
        phase: 'LAND_PREPARATION',
        day: null,
        label: 'Land Prep'
    };
};

// --- NEW: ADAPTIVE SCHEDULING ---

export const calculateEffectiveDay = (plot: Plot, targetDate: Date | string = new Date()): { rawDay: number, effectiveDay: number, totalShift: number } => {
    // 1. Get Chronological Day
    const base = getPhaseAndDay(plot, targetDate);
    if (!base.day || base.phase !== 'CROP_CYCLE') {
        return { rawDay: base.day || 0, effectiveDay: base.day || 0, totalShift: 0 };
    }

    const rawDay = base.day;

    // 2. Calculate Shifts (Delays) up to targetDate
    const targetNoon = toLocalNoon(targetDate);
    let totalShift = 0;

    if (plot.scheduleShifts) {
        plot.scheduleShifts.forEach(shift => {
            const shiftDate = toLocalNoon(shift.date);
            // Use shift if it happened BEFORE or ON target date
            if (shiftDate <= targetNoon) {
                totalShift += shift.shiftDays;
            }
        });
    }

    // Effective Day = Chronological - Delays
    // Example: Day 50, Delay 2 => Effective Day 48 (Plant is younger than time says)
    const effectiveDay = Math.max(1, rawDay - totalShift);

    return { rawDay, effectiveDay, totalShift };
};

// Stub for getTimelineBlocks (under development)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
export const getTimelineBlocks = (_plot: Plot, _logs: any[]): any[] => {
    // TODO: Implement timeline block generation from plot schedule and logs
    console.warn('getTimelineBlocks is not yet implemented');
    return [];
};

export const getEffectivePhaseAndDay = (plot: Plot, targetDate: Date | string = new Date()): PhaseResult => {
    const base = getPhaseAndDay(plot, targetDate);

    if (base.phase === 'CROP_CYCLE' && base.day) {
        const { effectiveDay, totalShift } = calculateEffectiveDay(plot, targetDate);

        let label = base.label;
        if (totalShift > 0) {
            label = `Day ${effectiveDay} (Chron. ${base.day})`;
        }

        return {
            ...base,
            day: effectiveDay, // Return EFFECTIVE day as primary driven value for scheduler
            effectiveDay,
            lossDays: totalShift,
            label
        };
    }

    return base;
};