/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { CropProfile, WorkflowStep } from '../types';
import { PlotScheduleInstance } from '../features/scheduler/scheduler.types';
import { getDateKey } from '../domain/system/DateKeyService';

// --- SCHEDULE INSTANCE FACTORY ---
const createScheduleInstance = (
    plotId: string,
    templateId: string,
    referenceType: 'PLANTING' | 'PRUNING' | 'SOWING' | 'TRANSPLANTING',
    referenceDate: string
): PlotScheduleInstance => ({
    id: `sch_${plotId}`,
    plotId,
    templateId,
    referenceType,
    referenceDate,
    stageOverrides: [],
    expectationOverrides: []
});

// Helper to generate dynamic dates relative to today (Dynamic Evaluation)
const getRelativeDate = (offsetDays: number) => {
    const d = new Date(); // Always fresh
    d.setDate(d.getDate() + offsetDays);
    return getDateKey(d);
};

// --- ACTIVITY LIBRARIES ---

const GRAPES_ACTIVITIES: WorkflowStep[] = [
    { id: 'gw_1', name: 'Ethrel Spray', type: 'activity' },
    { id: 'gw_3', name: 'Fruit Pruning', type: 'activity' },
    { id: 'gw_4', name: 'Paste Application', type: 'activity' },
    { id: 'gw_5', name: 'Spray (Dormant)', type: 'activity', isRepeatable: true },
    { id: 'gw_6', name: 'Watering (Start)', type: 'activity' },
    { id: 'gw_7', name: 'Shoot Breaking', type: 'activity', isRepeatable: true },
    { id: 'gw_8', name: 'Dipping', type: 'activity', isRepeatable: true },
    { id: 'gw_2', name: 'Drying Gap', type: 'gap', defaultDays: 5 }
];

const POMEGRANATE_ACTIVITIES: WorkflowStep[] = [
    { id: 'pw_1', name: 'Bahar Treatment', type: 'activity' },
    { id: 'pw_2', name: 'Defoliation', type: 'activity' },
    { id: 'pw_3', name: 'Pruning', type: 'activity' },
    { id: 'pw_4', name: 'Fertigation', type: 'activity', isRepeatable: true },
    { id: 'pw_5', name: 'Crop Support', type: 'activity' },
    { id: 'pw_6', name: 'Harvesting', type: 'activity' }
];

const SUGARCANE_ACTIVITIES: WorkflowStep[] = [
    { id: 'sw_1', name: 'Planting', type: 'activity' },
    { id: 'sw_2', name: 'Irrigation', type: 'activity', isRepeatable: true },
    { id: 'sw_3', name: 'Weeding', type: 'activity', isRepeatable: true },
    { id: 'sw_4', name: 'Fertilizer Dose', type: 'activity' },
    { id: 'sw_5', name: 'Earthing Up', type: 'activity' }
];

const DEFAULT_ACTIVITIES: WorkflowStep[] = [
    { id: 'dw_1', name: 'Sowing', type: 'activity' },
    { id: 'dw_2', name: 'Irrigation', type: 'activity', isRepeatable: true },
    { id: 'dw_3', name: 'Weeding', type: 'activity', isRepeatable: true },
    { id: 'dw_4', name: 'Spraying', type: 'activity', isRepeatable: true },
    { id: 'dw_5', name: 'Harvest', type: 'activity' }
];

/**
 * RAMU PATIL'S FARM CONFIGURATION
 *
 * STRUCTURE: 4 crops total
 * - Grapes: 2 plots (Export Plot A, Local Plot B)
 * - Pomegranate: 2 plots (Bhagwa #1, Bhagwa #2)
 * - Sugarcane: 1 plot (River Bank)
 * - Onion: 1 plot (Summer Crop)
 *
 * TOTAL: 6 plots across 4 crops
 *
 * This structure enables demo scenarios:
 * - Same-day different work on different plots (Grapes A vs B)
 * - Same work across multiple plots (Pomegranate #1 & #2 spray together)
 * - Multi-crop farm management
 * - Mixed irrigation methods (Drip, Flood, Sprinkler)
 */
export const RAMUS_FARM: CropProfile[] = [
    {
        id: 'c1',
        name: 'Grapes',
        iconName: 'Grape',
        color: 'bg-indigo-500',
        activeScheduleId: 'tpl_grape_fpo_v1',
        lifecycle: 'Long (>1 year)',
        workflow: GRAPES_ACTIVITIES,
        contractUnitDefault: 'Tree',
        supportedTasks: ['Pruning', 'Paste', 'Spraying', 'Dipping', 'Harvesting', 'Training'],
        createdAt: getRelativeDate(-365 * 3),
        plots: [
            {
                // Plot A: Compare demo - should show ON TRACK stage match
                id: 'p1_1',
                name: 'Export Plot (A)',
                variety: 'Thompson Seedless',
                startDate: getRelativeDate(-29), // Last-month stage compare window
                createdAt: getRelativeDate(-365 * 2),
                baseline: { totalArea: 2.0, unit: 'Acre' },
                infrastructure: {
                    irrigationMethod: 'Drip',
                    linkedMotorId: 'm1'
                },
                irrigationPlan: {
                    frequency: 'Daily',
                    durationMinutes: 90,
                    preferredTime: 'Morning',
                    planStartDate: getRelativeDate(-29),
                    method: 'Drip',
                    motorId: 'm1'
                },
                schedule: createScheduleInstance('p1_1', 'tpl_grape_fpo_v1', 'PRUNING', getRelativeDate(-29))
            },
            {
                // Plot B: Compare demo - should show BEHIND + critical misses
                id: 'p1_2',
                name: 'Local Plot (B)',
                variety: 'Sonaka',
                startDate: getRelativeDate(-29), // Last-month stage compare window
                createdAt: getRelativeDate(-365 * 2),
                baseline: { totalArea: 1.5, unit: 'Acre' },
                infrastructure: {
                    irrigationMethod: 'Drip',
                    linkedMotorId: 'm1' // Same motor - conflict potential
                },
                irrigationPlan: {
                    frequency: 'Alternate',
                    durationMinutes: 120,
                    preferredTime: 'Evening',
                    planStartDate: getRelativeDate(-29),
                    method: 'Drip',
                    motorId: 'm1'
                },
                schedule: createScheduleInstance('p1_2', 'tpl_grape_fpo_v1', 'PRUNING', getRelativeDate(-29))
            }
        ]
    },
    {
        id: 'c2',
        name: 'Pomegranate',
        iconName: 'Pomegranate',
        color: 'bg-rose-500',
        activeScheduleId: 'tpl_pomegranate_mrig_v1',
        lifecycle: 'Long (>1 year)',
        workflow: POMEGRANATE_ACTIVITIES,
        contractUnitDefault: 'Tree',
        supportedTasks: ['Bahar', 'Pruning', 'Spraying', 'Fertigation', 'Harvesting'],
        createdAt: getRelativeDate(-365 * 2),
        plots: [
            {
                // Plot #1: Compare demo - EXTRA execution over plan
                id: 'p2_1',
                name: 'Bhagwa #1',
                variety: 'Bhagwa',
                startDate: getRelativeDate(-29), // Last-month stage compare window
                createdAt: getRelativeDate(-365),
                baseline: { totalArea: 2.0, unit: 'Acre' },
                infrastructure: {
                    irrigationMethod: 'Drip',
                    linkedMotorId: 'm3'
                },
                irrigationPlan: {
                    frequency: 'Daily',
                    durationMinutes: 45,
                    preferredTime: 'Morning',
                    planStartDate: getRelativeDate(-29),
                    method: 'Drip',
                    motorId: 'm3'
                },
                schedule: createScheduleInstance('p2_1', 'tpl_pomegranate_mrig_v1', 'PRUNING', getRelativeDate(-29))
            },
            {
                // Plot #2: Compare demo - negotiable delays due logged issue
                id: 'p2_2',
                name: 'Bhagwa #2',
                variety: 'Bhagwa',
                startDate: getRelativeDate(-29), // Last-month stage compare window
                createdAt: getRelativeDate(-365),
                baseline: { totalArea: 2.0, unit: 'Acre' },
                infrastructure: {
                    irrigationMethod: 'Drip',
                    linkedMotorId: 'm3' // Same motor - shared irrigation
                },
                irrigationPlan: {
                    frequency: 'Daily',
                    durationMinutes: 45,
                    preferredTime: 'Morning',
                    planStartDate: getRelativeDate(-29),
                    method: 'Drip',
                    motorId: 'm3'
                },
                schedule: createScheduleInstance('p2_2', 'tpl_pomegranate_mrig_v1', 'PRUNING', getRelativeDate(-29))
            }
        ]
    },
    {
        id: 'c3',
        name: 'Sugarcane',
        iconName: 'Sugarcane',
        color: 'bg-green-600',
        activeScheduleId: 'tpl_sugarcane_v1',
        lifecycle: 'Long (>1 year)',
        workflow: SUGARCANE_ACTIVITIES,
        contractUnitDefault: 'Acre',
        supportedTasks: ['Irrigation', 'Fertilizer', 'Weeding', 'Earthing Up'],
        createdAt: getRelativeDate(-200),
        plots: [
            {
                // Compare demo - critical input miss in current stage
                id: 'p3_1',
                name: 'River Bank',
                variety: 'Co 86032',
                startDate: getRelativeDate(-60), // Stage-2 window for input vs execution
                createdAt: getRelativeDate(-200),
                baseline: { totalArea: 4.0, unit: 'Acre' },
                infrastructure: {
                    irrigationMethod: 'Flood',
                    linkedMotorId: 'm2'
                },
                irrigationPlan: {
                    frequency: 'Weekly',
                    durationMinutes: 300,
                    preferredTime: 'Night',
                    planStartDate: getRelativeDate(-60),
                    method: 'Flood',
                    motorId: 'm2'
                },
                schedule: createScheduleInstance('p3_1', 'tpl_sugarcane_v1', 'PLANTING', getRelativeDate(-60))
            }
        ]
    },
    {
        id: 'c4',
        name: 'Onion',
        iconName: 'Onion',
        color: 'bg-purple-500',
        activeScheduleId: 'tpl_onion_v1',
        lifecycle: 'Short (≤120 days)',
        workflow: DEFAULT_ACTIVITIES,
        contractUnitDefault: 'Acre',
        supportedTasks: ['Spraying', 'Weeding', 'Harvesting'],
        createdAt: getRelativeDate(-45),
        plots: [
            {
                // Report-card demo plot with clear stage-level gaps
                id: 'p4_1',
                name: 'Summer Crop',
                variety: 'Nashik Red',
                startDate: getRelativeDate(-10), // Early stage so compare shows must-do clarity
                createdAt: getRelativeDate(-65),
                baseline: { totalArea: 1.0, unit: 'Acre' },
                infrastructure: {
                    irrigationMethod: 'Sprinkler',
                    linkedMotorId: 'm2'
                },
                irrigationPlan: {
                    frequency: 'Every 3 Days',
                    durationMinutes: 90,
                    preferredTime: 'Morning',
                    planStartDate: getRelativeDate(-10),
                    method: 'Sprinkler',
                    motorId: 'm2'
                },
                schedule: createScheduleInstance('p4_1', 'tpl_onion_v1', 'TRANSPLANTING', getRelativeDate(-10))
            }
        ]
    }
];

export const getCropById = (id: string) => RAMUS_FARM.find(c => c.id === id);

// Utility to calculate Current Day & Phase for a plot
export const getPhaseAndDay = (plot: import('../types').Plot) => {
    if (!plot.startDate) return { phase: 'Preparatory', day: 0 };

    const start = new Date(plot.startDate);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Simple phase logic based on day count (Generic fallback)
    let phase = 'Vegetative';
    if (diffDays < 15) phase = 'Germination / Early Stage';
    else if (diffDays > 45 && diffDays < 90) phase = 'Flowering & Fruiting';
    else if (diffDays >= 90) phase = 'Maturity / Harvest';

    return { phase, day: diffDays };
};

// --- LEGACY MOCK DATA (Used as fallback before DemoDataService generates data) ---
// NOTE: The primary demo data is now generated by DemoDataService.generateRollingDemoData()
export const MOCK_LOGS: import('../types').DailyLog[] = [];
