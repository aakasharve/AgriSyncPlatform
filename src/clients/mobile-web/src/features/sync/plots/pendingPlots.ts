// spec: plr-d10-redesign-real-integration-2026-10-25 (I9 — X3)
//
// The phone's own record of plots it made and has queued but the server has not sent back
// yet — deliberately NOT the phone's copies of the server's plots and cycles (`db.plots`,
// `db.cropCycles`), which must keep meaning "the server has this". Read by the log path so
// a log on a just-made plot is queued straight away against that plot's (derived) crop
// cycle, behind the plot and cycle that were queued first — whatever date the log carries
// — but only while those two rows are live (`findSendablePendingPlot`).

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { isPhoneMadePlotSendable } from '../../../infrastructure/sync/MutationDependency';

/** What a phone-made plot needs to be (re)sent, captured when it is made — farm included. */
export interface PendingPlotRegistration {
    plotId: string;
    farmId: string;
    name: string;
    areaInAcres: number;
    cropName: string;
    startDate: string;
}

export const PENDING_PLOT_REGISTRATIONS_KEY = 'agrisync_pending_plot_registrations_v1';

export async function readPendingPlotRegistrations(): Promise<PendingPlotRegistration[]> {
    try {
        const row = await getDatabase().uiPrefs.get(PENDING_PLOT_REGISTRATIONS_KEY);
        return Array.isArray(row?.value) ? (row.value as PendingPlotRegistration[]) : [];
    } catch {
        return [];
    }
}

export async function writePendingPlotRegistrations(list: PendingPlotRegistration[]): Promise<void> {
    await getDatabase().uiPrefs.put({ key: PENDING_PLOT_REGISTRATIONS_KEY, value: list });
}

export async function findPendingPlotRegistration(plotId: string): Promise<PendingPlotRegistration | null> {
    return (await readPendingPlotRegistrations()).find((p) => p.plotId === plotId) ?? null;
}

/**
 * The registration a LOG may be queued against: recorded here, AND its plot and crop-cycle
 * rows are in this phone's queue and can still reach the server. A plot the server refused
 * (a worker's plot, a lapsed plan) or the farmer discarded stays on the list — a retry from
 * the conflict screen can revive it — but no new log is queued on it meanwhile: each one
 * would only be refused in turn. Such a log stays on the phone, reported as unsent.
 */
export async function findSendablePendingPlot(plotId: string): Promise<PendingPlotRegistration | null> {
    const reg = await findPendingPlotRegistration(plotId);
    if (!reg) return null;
    const sendable = await isPhoneMadePlotSendable(mutationQueue.getDeviceId(), reg.plotId, await cropCycleIdForPlot(reg.plotId));
    return sendable ? reg : null;
}

/** 32-bit FNV-1a, seeded — only for the no-Web-Crypto fallback below. */
function fnv1a(text: string, seed: number): number {
    let h = (0x811c9dc5 ^ seed) >>> 0;
    for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

function toUuidV5Shape(bytes: Uint8Array): string {
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The crop cycle id for a phone-made plot, derived from the plot id (a name-based UUID,
 * RFC 4122 version 5 over SHA-1), so the same plot always yields the same cycle. Where Web
 * Crypto is missing it is still derived — from four seeded FNV-1a hashes — never random,
 * because a random id would make a second cycle on a re-send.
 */
export async function cropCycleIdForPlot(plotId: string): Promise<string> {
    const name = `agrisync:crop-cycle:${plotId}`;
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
        try {
            return toUuidV5Shape(new Uint8Array(await subtle.digest('SHA-1', new TextEncoder().encode(name))));
        } catch {
            // fall through to the deterministic fallback
        }
    }
    const bytes = new Uint8Array(16);
    for (let part = 0; part < 4; part += 1) {
        const h = fnv1a(name, part);
        bytes[part * 4] = h >>> 24;
        bytes[part * 4 + 1] = (h >>> 16) & 0xff;
        bytes[part * 4 + 2] = (h >>> 8) & 0xff;
        bytes[part * 4 + 3] = h & 0xff;
    }
    return toUuidV5Shape(bytes);
}
