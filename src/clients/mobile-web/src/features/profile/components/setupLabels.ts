/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5) — the words a farmer reads for the
 * REAL stored setup values. Stored values stay exactly as they are (`'Well'`, `'MSEB'`, `'3'`, …);
 * only what is shown is Marathi. Every Marathi string is PROPOSED (from the approved preview).
 */
import type { FarmMachinery, FarmMotor, LandUnit, PlotInfrastructure, WaterResource } from '../../../domain/types/farm.types';

export const SOURCE_TYPES: readonly WaterResource['type'][] = ['Well', 'Borewell', 'Canal', 'Farm Pond', 'Tanker'];
export const SOURCE_TYPE_LABEL: Record<WaterResource['type'], string> = {
    Well: 'विहीर', Borewell: 'बोअरवेल', Canal: 'कालवा', 'Farm Pond': 'शेततळं', Tanker: 'टँकर',
};

export const PHASE_LABEL: Record<FarmMotor['phase'], string> = { '1': 'सिंगल फेज', '3': 'थ्री फेज' };

export const POWER_SOURCES: readonly FarmMotor['powerSourceType'][] = ['MSEB', 'Solar', 'Generator'];
export const POWER_SOURCE_LABEL: Record<FarmMotor['powerSourceType'], string> = {
    MSEB: 'महावितरण वीज', Solar: 'सोलर', Generator: 'डिझेल',
};

export const PIPE_SIZES = ['12mm', '16mm', '20mm'] as const;
/** "16mm" → "16 मिमी"; any other stored text is shown as it is. */
export const pipeLabel = (size?: string): string => (size ? size.replace(/mm$/, ' मिमी') : '');

/** The types the add form offers (the real form never offered 'Other'). */
export const MACHINE_TYPES: readonly FarmMachinery['type'][] = ['Tractor', 'Sprayer', 'Rotavator', 'Harvester'];
export const MACHINE_TYPE_LABEL: Record<FarmMachinery['type'], string> = {
    Tractor: 'ट्रॅक्टर', Sprayer: 'फवारणी यंत्र', Rotavator: 'रोटाव्हेटर', Harvester: 'हार्वेस्टर', Other: 'इतर',
};
export const OWNERSHIP_LABEL: Record<FarmMachinery['ownership'], string> = { Owned: 'स्वतःचं', Rented: 'भाड्याचं' };

export const LAND_UNIT_LABEL: Record<LandUnit, string> = { Acre: 'एकर', Guntha: 'गुंठे', Are: 'आर' };

/** 'None' is not shown — it says nothing a farmer needs to read. */
export const IRRIGATION_LABEL: Record<PlotInfrastructure['irrigationMethod'], string | null> = {
    Drip: 'ठिबक', Flood: 'पाट पाणी', Sprinkler: 'तुषार', None: null,
};

/** "7.5 HP · थ्री फेज · महावितरण वीज" */
export const motorLine = (m: FarmMotor): string =>
    `${m.hp} HP · ${PHASE_LABEL[m.phase] ?? m.phase} · ${POWER_SOURCE_LABEL[m.powerSourceType] ?? m.powerSourceType}`;
