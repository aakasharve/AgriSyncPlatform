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

/** The types the form offers, in the founder's order (repair FIX-1 item 7, 27 Nov): ब्लोअर and इतर added. */
export const MACHINE_TYPES: readonly FarmMachinery['type'][] = ['Tractor', 'Blower', 'Sprayer', 'Rotavator', 'Harvester', 'Other'];
export const MACHINE_TYPE_LABEL: Record<FarmMachinery['type'], string> = {
    Tractor: 'ट्रॅक्टर', Blower: 'ब्लोअर', Sprayer: 'फवारणी यंत्र', Rotavator: 'रोटाव्हेटर', Harvester: 'हार्वेस्टर', Other: 'इतर',
};
export const OWNERSHIP_LABEL: Record<FarmMachinery['ownership'], string> = { Owned: 'स्वतःचं', Rented: 'भाड्याचं' };

/** Repair FIX-1 item 7 — the optional details a machine may carry. */
export type MachineDetail = 'company' | 'model' | 'hp' | 'nozzleCount' | 'capacity' | 'otherDetails';
export const MACHINE_DETAIL_KEYS: readonly MachineDetail[] = ['company', 'model', 'hp', 'nozzleCount', 'capacity', 'otherDetails'];

/** The details the form asks for each type (founder 27 Nov); all optional — the name is the only required field. */
export const MACHINE_DETAILS: Record<FarmMachinery['type'], readonly MachineDetail[]> = {
    Tractor: ['company', 'model', 'hp'],
    Blower: ['company', 'model', 'nozzleCount', 'capacity', 'otherDetails'],
    Sprayer: ['company', 'model', 'nozzleCount', 'capacity', 'otherDetails'],
    Rotavator: ['company', 'model'],
    Harvester: ['company', 'model'],
    Other: ['company', 'model'],
};

/** Each detail's label, test id and kind. "टाकी (लिटर)" is the form's old word; the rest are new (PROPOSED). */
export const MACHINE_DETAIL_FIELD: Record<MachineDetail, { label: string; testId: string; kind: 'text' | 'number'; placeholder?: string }> = {
    company: { label: 'कंपनी', testId: 'machine-company', kind: 'text' },
    model: { label: 'मॉडेल', testId: 'machine-model', kind: 'text' },
    hp: { label: 'HP', testId: 'machine-hp', kind: 'number', placeholder: 'उदा. 45' },
    nozzleCount: { label: 'नोझलची संख्या', testId: 'machine-nozzles', kind: 'number', placeholder: 'उदा. 4' },
    capacity: { label: 'टाकी (लिटर)', testId: 'machine-tank', kind: 'number', placeholder: 'उदा. 200' },
    otherDetails: { label: 'इतर माहिती', testId: 'machine-other', kind: 'text' },
};

/** "स्वतःचं · ब्लोअर · मित्रा टर्बो · 4 नोझल · टाकी 600 लिटर": every detail the machine carries, in plain words. */
export const machineLine = (m: FarmMachinery): string => {
    const parts = [OWNERSHIP_LABEL[m.ownership] ?? m.ownership, MACHINE_TYPE_LABEL[m.type] ?? m.type];
    const make = [m.company, m.model].map(s => s?.trim()).filter(Boolean).join(' ');
    if (make) parts.push(make);
    if (m.hp) parts.push(`${m.hp} HP`);
    if (m.nozzleCount) parts.push(`${m.nozzleCount} नोझल`);
    if (m.capacity) parts.push(`टाकी ${m.capacity} लिटर`);
    return parts.join(' · ');
};

export const LAND_UNIT_LABEL: Record<LandUnit, string> = { Acre: 'एकर', Guntha: 'गुंठे', Are: 'आर' };

/** 'None' is not shown — it says nothing a farmer needs to read. */
export const IRRIGATION_LABEL: Record<PlotInfrastructure['irrigationMethod'], string | null> = {
    Drip: 'ठिबक', Flood: 'पाट पाणी', Sprinkler: 'तुषार', None: null,
};

/** "7.5 HP · थ्री फेज · महावितरण वीज" */
export const motorLine = (m: FarmMotor): string =>
    `${m.hp} HP · ${PHASE_LABEL[m.phase] ?? m.phase} · ${POWER_SOURCE_LABEL[m.powerSourceType] ?? m.powerSourceType}`;
