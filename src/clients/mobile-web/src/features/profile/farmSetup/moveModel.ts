/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P10; contract §6) - the move of the water, motor, power and machine details a
 * phone held before (its one-row profile) to ONE farm on the server. There is no server-side move: the phone asks its own person, and the answer goes as
 * ordinary farm-setup changes, each checked for "edit farm setup" on THAT farm (one person's set can never be copied into every farm).
 *   1. Never by itself: nothing is sent until he says yes.
 *   3. Demo values are never offered: only an id `w_` / `m_` / `mach_` + a GUID is his.
 *   7. A farm that already has a set is offered his items UNTICKED - nothing is merged or replaced by itself.
 *   8. `w_<uuid>` -> `<uuid>` (and `m_`, `mach_`): a second try makes the same ids, and the server answers "already there", never doubles.
 *   9. Not moved: a motor's made-up timetable, a plot's 'None' default, a plot's ticked machines, `defaultOperatorId`.
 *  10. The phone profile is NOT emptied in this lane; the flag records which farm it went to.
 * The flag is kept per person in `appMeta`. CTO calls taken: asked on the page (not a pop-up), unticked rule, stripped ids, kept profile.
 */
import type { ElectricityTimingConfiguration, FarmerProfile, FarmMachinery, FarmMotor, WaterResource } from '../../../domain/types/farm.types';
import type { AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { powerTimesSaved } from '../hubSteps';
import { normalizeConfig } from '../components/electricityTiming';
import { saveMachine, saveWaterSource, setPowerTimes } from './farmSetupCommands';
import { machineInputOf, waterSourceInputOf } from './farmSetupView';

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PREFIXED = { w: new RegExp(`^w_(${GUID})$`, 'i'), m: new RegExp(`^m_(${GUID})$`, 'i'), mach: new RegExp(`^mach_(${GUID})$`, 'i') };

/** Rule 8: the phone's id without its prefix, or null when it is not his (a demo id, or any other shape). */
export function serverIdOf(kind: keyof typeof PREFIXED, id: string): string | null {
    return PREFIXED[kind].exec(id)?.[1]?.toLowerCase() ?? null;
}

export interface MovableSource { key: string; source: WaterResource; motors: FarmMotor[] }
export interface MovableMachine { key: string; machine: FarmMachinery }
export interface MovableItems {
    sources: MovableSource[];
    /** His timetable, only when he really saved one (the app's own starting timetable is not his). */
    power: { key: 'power'; timetable: ElectricityTimingConfiguration } | null;
    machines: MovableMachine[];
}

/** What this phone's profile holds that is HIS (rule 3), with the server's ids (rule 8) and without what is not moved (rule 9). */
export function movableItems(profile: FarmerProfile): MovableItems {
    const sources = (profile.waterResources ?? []).flatMap((source): MovableSource[] => {
        const id = serverIdOf('w', source.id);
        if (!id) return [];
        const motors = (profile.motors ?? []).filter(m => m.linkedWaterSourceId === source.id).flatMap((m): FarmMotor[] => {
            const motorId = serverIdOf('m', m.id);
            if (!motorId || !m.name?.trim() || !(m.hp > 0)) return [];
            const { schedule: _madeUp, ...rest } = m;
            void _madeUp;
            return [{ ...rest, id: motorId, linkedWaterSourceId: id }];
        });
        return [{ key: `source:${id}`, source: { ...source, id }, motors }];
    });
    const machines = (profile.machineries ?? []).flatMap((machine): MovableMachine[] => {
        const id = serverIdOf('mach', machine.id);
        if (!id || !machine.name?.trim()) return [];
        const { defaultOperatorId: _notMoved, ...rest } = machine;
        void _notMoved;
        return [{ key: `machine:${id}`, machine: { ...rest, id } }];
    });
    const power = powerTimesSaved(profile.electricityTiming) && profile.electricityTiming
        ? { key: 'power' as const, timetable: profile.electricityTiming }
        : null;
    return { sources, power, machines };
}

export const hasMovable = (items: MovableItems): boolean => items.sources.length > 0 || items.machines.length > 0 || items.power !== null;
export const allKeys = (items: MovableItems): string[] => [...items.sources.map(s => s.key), ...(items.power ? [items.power.key] : []), ...items.machines.map(m => m.key)];

/** Sends the ticked items to ONE farm as ordinary farm-setup changes. Returns the keys that could not be queued (they stay on the phone). */
export async function sendMove(farmId: string, items: MovableItems, ticked: ReadonlySet<string>): Promise<string[]> {
    const failed: string[] = [];
    const attempt = async (key: string, run: () => Promise<unknown>) => {
        if (!ticked.has(key)) return;
        try { await run(); } catch { failed.push(key); }
    };
    for (const s of items.sources) await attempt(s.key, () => saveWaterSource(waterSourceInputOf(farmId, s.source, s.motors)));
    if (items.power) {
        const t = normalizeConfig(items.power.timetable);
        await attempt(items.power.key, () => setPowerTimes({ farmId, timetable: { singlePhase: t.singlePhase, threePhase: t.threePhase } }));
    }
    for (const m of items.machines) await attempt(m.key, () => saveMachine(machineInputOf(farmId, m.machine)));
    return failed;
}

// ── the per-person flag (rule 2, rule 10) ─────────────────────────────────────────────────────────────

export type MoveState = 'sent' | 'later' | 'dismissed';
export interface MoveFlag { state: MoveState; farmId?: string; at: string }

export const moveFlagKey = (userId: string): string => `farmSetupMove:${userId}`;

export async function readMoveFlag(db: AgriLogDatabase, userId: string): Promise<MoveFlag | null> {
    const row = await db.appMeta.get(moveFlagKey(userId));
    const value = row?.value as MoveFlag | undefined;
    return value && (value.state === 'sent' || value.state === 'later' || value.state === 'dismissed') ? value : null;
}

export async function writeMoveFlag(db: AgriLogDatabase, userId: string, flag: MoveFlag): Promise<void> {
    await db.appMeta.put({ key: moveFlagKey(userId), value: flag, updatedAt: flag.at });
}
