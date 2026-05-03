/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    HarvestConfig,
    HarvestSession,
    HarvestUnit,
    OtherIncomeEntry
} from '../logs/harvest.types';
import {
    readHarvestConfigRaw,
    readHarvestSessionsRaw,
    readOtherIncomeRaw,
    writeHarvestConfigRaw,
    writeHarvestSessionsRaw,
    writeOtherIncomeRaw,
} from '../../infrastructure/storage/HarvestLegacyStore';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';
import { financeCommandService } from './financeCommandService';

// --- CONSTANTS ---

// Mock storage for simple prototype
// In a real app, this would be in localStorage or a database
const HARVEST_CONFIGS: Record<string, HarvestConfig> = {};
const HARVEST_SESSIONS: Record<string, HarvestSession[]> = {};

export const CROP_HARVEST_PRESETS: Record<string, HarvestUnit[]> = {
    // Fruits
    'grapes': [
        { type: 'CONTAINER', containerName: 'Crate (10kg)', containerSizeKg: 10 },
        { type: 'CONTAINER', containerName: 'Crate (14kg)', containerSizeKg: 14 }, // Export
        { type: 'WEIGHT', weightUnit: 'KG' }
    ],
    'pomegranate': [
        { type: 'CONTAINER', containerName: 'Crate (10kg)', containerSizeKg: 10 },
        { type: 'CONTAINER', containerName: 'Box (4kg)', containerSizeKg: 4 },
        { type: 'WEIGHT', weightUnit: 'KG' }
    ],
    'banana': [
        { type: 'WEIGHT', weightUnit: 'TON' },
        { type: 'WEIGHT', weightUnit: 'QUINTAL' },
        { type: 'CONTAINER', containerName: 'Comb/Bunch', containerSizeKg: 25 } // Approx
    ],
    'mango': [
        { type: 'CONTAINER', containerName: 'Crate (20kg)', containerSizeKg: 20 },
        { type: 'CONTAINER', containerName: 'Box (10kg)', containerSizeKg: 10 },
        { type: 'COUNT' } // Dozens
    ],

    // Vegetables
    'tomato': [
        { type: 'CONTAINER', containerName: 'Crate (25kg)', containerSizeKg: 25 },
        { type: 'WEIGHT', weightUnit: 'KG' }
    ],
    'onion': [
        { type: 'CONTAINER', containerName: 'Bag (~50kg)', containerSizeKg: 50 },
        { type: 'WEIGHT', weightUnit: 'QUINTAL' }
    ],
    'potato': [
        { type: 'CONTAINER', containerName: 'Bag (~50kg)', containerSizeKg: 50 },
        { type: 'WEIGHT', weightUnit: 'QUINTAL' }
    ],

    // Cash Crops
    'sugarcane': [
        { type: 'WEIGHT', weightUnit: 'TON' }
    ],
    'cotton': [
        { type: 'WEIGHT', weightUnit: 'QUINTAL' },
        { type: 'WEIGHT', weightUnit: 'KG' }
    ],
    'soybean': [
        { type: 'WEIGHT', weightUnit: 'QUINTAL' },
        { type: 'CONTAINER', containerName: 'Bag (~50kg)', containerSizeKg: 50 }
    ],
    'maize': [
        { type: 'WEIGHT', weightUnit: 'QUINTAL' },
        { type: 'WEIGHT', weightUnit: 'TON' }
    ],

    // Default Fallback
    'default': [
        { type: 'WEIGHT', weightUnit: 'KG' },
        { type: 'WEIGHT', weightUnit: 'QUINTAL' },
        { type: 'CONTAINER', containerName: 'Crate/Bag', containerSizeKg: 20 }
    ]
};



/**
 * Get the harvest configuration for a specific plot
 */
export const getHarvestConfig = (plotId: string): HarvestConfig | null => {
    // Check local storage first (simulated persistence)
    const stored = readHarvestConfigRaw(plotId);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error("Failed to parse harvest config", e);
            return null;
        }
    }

    return HARVEST_CONFIGS[plotId] || null;
};

/**
 * Save harvest configuration for a plot
 */
export const saveHarvestConfig = (config: HarvestConfig): void => {
    HARVEST_CONFIGS[config.plotId] = config;
    writeHarvestConfigRaw(config.plotId, JSON.stringify(config));
};

/**
 * Get all harvest sessions for a plot/crop
 */
export const getHarvestSessions = (plotId: string, cropId: string): HarvestSession[] => {
    const keyStr = `${plotId}_${cropId}`;
    const stored = readHarvestSessionsRaw(plotId, cropId);

    if (stored) {
        try {
            HARVEST_SESSIONS[keyStr] = JSON.parse(stored);
        } catch (e) {
            console.error("Failed to parse harvest sessions", e);
            HARVEST_SESSIONS[keyStr] = [];
        }
    }

    return HARVEST_SESSIONS[keyStr] || [];
};

/**
 * Start a new harvest session
 */
export const startHarvestSession = (
    plotId: string,
    cropId: string,
    config: HarvestConfig
): HarvestSession => {
    const sessions = getHarvestSessions(plotId, cropId);

    // Determine picking number
    let pickingNumber = 1;
    if (config.pattern === 'MULTIPLE') {
        pickingNumber = sessions.length + 1;
    } else {
        // For SINGLE harvest, if we already have one, are we restarting?
        // Assuming strictly one session per cycle for SINGLE for now.
        // Or maybe they closed it and are reopening?
        // Let's just append.
    }

    const newSession: HarvestSession = {
        id: `sess_${idGenerator.generate()}`,
        plotId,
        cropId,
        pattern: config.pattern,
        pickingNumber: config.pattern === 'MULTIPLE' ? pickingNumber : undefined,
        startDate: systemClock.nowISO(),
        status: 'IN_PROGRESS',
        harvestEntries: [],
        totalQuantitySent: 0,
        totalUnitsSent: 0,
        unit: config.primaryUnit,
        saleEntries: [],
        totalIncome: 0,
        gradeWiseBreakdown: [],
        pattiStatus: 'PENDING',
        paymentStatus: 'PENDING',
        amountReceived: 0,
        amountPending: 0,
        linkedLogIds: [],
        createdAt: systemClock.nowISO()
    };

    const keyStr = `${plotId}_${cropId}`;
    const updatedSessions = [newSession, ...sessions]; // Newest first
    HARVEST_SESSIONS[keyStr] = updatedSessions;

    writeHarvestSessionsRaw(plotId, cropId, JSON.stringify(updatedSessions));

    return newSession;
};

/**
 * Seed harvest sessions (for Demo Data)
 */
export const seedHarvestSessions = (sessions: HarvestSession[]): void => {
    sessions.forEach(session => {
        const keyStr = `${session.plotId}_${session.cropId}`;

        // Get existing or init empty
        // We probably want to overwrite or append? For seeding, usually overwrite if empty.
        // But here we are iterating one by one.
        // Simplified: Just append this session to the list for this plot/crop

        const existingRaw = readHarvestSessionsRaw(session.plotId, session.cropId);
        const existing: HarvestSession[] = existingRaw ? JSON.parse(existingRaw) : [];

        // Avoid duplicates
        if (!existing.some(s => s.id === session.id)) {
            const updated = [session, ...existing];
            writeHarvestSessionsRaw(session.plotId, session.cropId, JSON.stringify(updated));
            HARVEST_SESSIONS[keyStr] = updated;
        }
    });
};

/**
 * Get the active session (IN_PROGRESS) if any
 */
export const getActiveHarvestSession = (plotId: string, cropId: string): HarvestSession | undefined => {
    const sessions = getHarvestSessions(plotId, cropId);
    return sessions.find(s => s.status === 'IN_PROGRESS');
};

/**
 * Get generic presets for units based on common crops
 * (This matches Phase 8 intent but putting logic here for now)
 */
export const getSuggestedUnitsForCrop = (cropName: string): HarvestUnit[] => {
    if (!cropName) return CROP_HARVEST_PRESETS['default'];
    const lower = cropName.toLowerCase();

    // Direct match check
    for (const [key, presets] of Object.entries(CROP_HARVEST_PRESETS)) {
        if (lower.includes(key)) {
            return presets;
        }
    }

    // Default
    return CROP_HARVEST_PRESETS['default'];
};

// --- OTHER INCOME ---

// Removed module-level initialization to support dynamic namespace switching
// let OTHER_INCOME_ENTRIES: OtherIncomeEntry[] = [];

const getStoredOtherIncome = (): OtherIncomeEntry[] => {
    const stored = readOtherIncomeRaw();
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error("Failed to parse other income", e);
        }
    }
    return [];
};

export const getOtherIncomeEntries = (plotId?: string): OtherIncomeEntry[] => {
    const entries = getStoredOtherIncome();
    // In real app, filter by plot
    if (plotId) {
        return entries.filter(e => e.plotId === plotId);
    }
    return entries;
};

export const addOtherIncomeEntry = (entry: Omit<OtherIncomeEntry, 'id'>): OtherIncomeEntry => {
    const newEntry: OtherIncomeEntry = {
        ...entry,
        id: `inc_${idGenerator.generate()}`
    };

    // Read current
    const currentEntries = getStoredOtherIncome();
    const updatedEntries = [newEntry, ...currentEntries];

    // Save
    writeOtherIncomeRaw(JSON.stringify(updatedEntries));

    financeCommandService.createMoneyEventFromSource({
        type: 'Income',
        sourceId: newEntry.id,
        dateTime: new Date(newEntry.date).toISOString(),
        eventType: 'Income',
        category: 'Other',
        cropId: newEntry.cropId,
        plotId: newEntry.plotId,
        amount: newEntry.amount,
        notes: `${newEntry.source}: ${newEntry.description}`,
        paymentMode: 'Cash'
    });

    return newEntry;
};

export const updateHarvestSession = (session: HarvestSession): void => {
    const keyStr = `${session.plotId}_${session.cropId}`;
    const sessions = getHarvestSessions(session.plotId, session.cropId);

    // Update list
    const updatedSessions = sessions.map(s => s.id === session.id ? session : s);
    HARVEST_SESSIONS[keyStr] = updatedSessions;

    // Persist
    writeHarvestSessionsRaw(session.plotId, session.cropId, JSON.stringify(updatedSessions));

    // Finance Integration: Sync Sales
    session.saleEntries.forEach(sale => {
        const saleUnit = sale.gradeWiseSales[0]?.unit || 'unit';
        financeCommandService.createMoneyEventFromSource({
            type: 'Income',
            sourceId: `${session.id}:sale:${sale.id}`,
            dateTime: sale.date + 'T12:00:00',
            eventType: 'Income',
            category: 'Other',
            amount: sale.netAmount,
            qty: sale.totalQuantity,
            unit: saleUnit === 'KG' || saleUnit === 'TON' || saleUnit === 'QUINTAL' ? 'kg' : 'unit',
            unitPrice: sale.gradeWiseSales[0]?.pricePerUnit || 0,
            paymentMode: 'Cash',
            cropId: session.cropId,
            plotId: session.plotId,
            notes: `Harvest Sale - ${sale.totalQuantity} ${saleUnit} - Patti: ${sale.pattiNumber || 'N/A'}`
        });
    });
};
