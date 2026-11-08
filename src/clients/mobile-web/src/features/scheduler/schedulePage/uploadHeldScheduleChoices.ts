/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2 Task 5; P10, P11) - the schedule choices this phone ALREADY
 * HOLDS go up to the server once.
 *
 * Before this lane a choice lived only in this phone's crop list. On the first pull of the version that can send it, every
 * plot that follows a schedule somebody chose - the crop's adopted one, or the plot's own, and not just the crop-type default
 * the download writes (`source` 'adopted' / 'plot', never 'default') - and that has no subscription yet, sends one
 * `adopt_schedule` (through `saveScheduleChoice`, so the choice is also kept as this phone's pending row at once). It runs
 * BEFORE the download is merged, so a download cannot overwrite the choice first.
 *
 * ONCE: the `appMeta` mark is written only after the server has answered every upload request (accepted, or refused and
 * parked) - a phone that is closed or offline in between asks again, and asking again sends nothing twice (a plot that
 * already has its pending row is "unchanged"). A refusal (no authority, a schedule the library does not list) keeps the
 * phone's choice visible and parked; it is never dropped. A 1.0.17 phone never sends an adopt: its own choice stays on it.
 *
 * Ruling (L8b-2, made exact in fix round 1 B007): a plot whose schedule IS the id the DOWNLOAD wrote as the crop default (recorded, never the phone catalog-first guess) is not uploaded even when the farmer adopted exactly that
 * schedule, because the download writes the default into the same crop field a choice goes to, so the two cannot be told
 * apart on a phone from before this lane. Showing the default and showing his choice are the same schedule.
 */
import { DexieCropsRepository } from '../../../infrastructure/storage/DexieCropsRepository';
import type { AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { isPlotChoice } from '../planning/ClientPlanEngine';
import { normalizeCropTypeKey, readCropTypeReferences } from '../../sync/pull/helpers/cropIdentity';
import { toDayKey } from './scheduleDates';
import { resolvePlotSchedule } from './resolveSchedule';
import { saveScheduleChoice, type ScheduleChoiceTarget } from './saveScheduleChoice';

/** `appMeta` key: written once the server has answered every request of the one-time upload. */
export const HELD_CHOICES_UPLOADED_KEY = 'l8b2.heldScheduleChoicesUploaded.v1';
/** `appMeta` key: the upload's requests, while the server has not yet answered them all. */
export const HELD_CHOICES_REQUESTS_KEY = 'l8b2.heldScheduleChoicesRequests.v1';

export type HeldUploadOutcome = 'done' | 'waiting' | 'sent' | 'nothing-to-send' | 'unavailable';

/** The statuses that mean "this request is still on its way to the server". */
const WAITING = new Set(['PENDING', 'SENDING', 'FAILED']);

const now = () => new Date().toISOString();

async function mark(db: AgriLogDatabase, key: string, value: unknown): Promise<void> {
    await db.appMeta.put({ key, value, updatedAt: now() });
}

export async function uploadHeldScheduleChoices(
    db: AgriLogDatabase,
    /** The pull being reconciled: its crop-type defaults are what the download is about to write (B007). */
    payload?: { cropTypes?: unknown[] },
): Promise<HeldUploadOutcome> {
    try {
        if ((await db.appMeta.get(HELD_CHOICES_UPLOADED_KEY)) !== undefined) return 'done';

        // Sent already: wait until the server has answered each request (accepted, refused and parked, or dropped).
        const sent = (await db.appMeta.get(HELD_CHOICES_REQUESTS_KEY))?.value as { clientRequestIds?: string[] } | undefined;
        if (sent?.clientRequestIds) {
            for (const clientRequestId of sent.clientRequestIds) {
                const row = await db.mutationQueue.filter(r => r.clientRequestId === clientRequestId).first();
                if (row && WAITING.has(row.status)) return 'waiting';
            }
            await mark(db, HELD_CHOICES_UPLOADED_KEY, { settledAtUtc: now() });
            await db.appMeta.delete(HELD_CHOICES_REQUESTS_KEY);
            return 'done';
        }

        const crops = await new DexieCropsRepository().getAll();
        const today = getDateKey();
        const held = new Set((await db.scheduleSubscriptions.toArray()).map(r => r.plotId));
        const targets: ScheduleChoiceTarget[] = [];
        const payloadDefaults = readCropTypeReferences(payload?.cropTypes ?? []);
        for (const crop of crops) {
            // B007 - the schedule the DOWNLOAD wrote into the crop (recorded by an earlier pull, or named by this one): never the
            // phone's own catalog-first guess.
            const downloadedDefaults = new Set([
                (crop as unknown as Record<string, unknown>).downloadedDefaultScheduleId,
                payloadDefaults.get(normalizeCropTypeKey(crop.name)),
            ].filter((id): id is string => typeof id === 'string'));
            for (const plot of crop.plots) {
                if (held.has(plot.id)) continue;
                const resolved = resolvePlotSchedule(crop, plot, today);
                if (!resolved || resolved.source === 'default') continue;
                if (!isPlotChoice(plot.schedule) && downloadedDefaults.has(resolved.template.id)) continue;
                // The plot's own day 0 goes with it when it is not simply the season's start.
                const day0 = resolved.instance.referenceDate;
                targets.push({
                    plotId: plot.id,
                    templateId: resolved.template.id,
                    referenceDate: day0 && day0 !== toDayKey(plot.startDate) ? day0 : null,
                });
            }
        }

        if (targets.length === 0) {
            await mark(db, HELD_CHOICES_UPLOADED_KEY, { settledAtUtc: now(), sent: 0 });
            return 'nothing-to-send';
        }

        const result = await saveScheduleChoice(targets);
        if (result.clientRequestIds.length === 0) {
            // Nothing could be queued (no season on the server yet, not server plots): the choices stay on this phone, as pending.
            await mark(db, HELD_CHOICES_UPLOADED_KEY, { settledAtUtc: now(), sent: 0 });
            return 'nothing-to-send';
        }

        await mark(db, HELD_CHOICES_REQUESTS_KEY, { clientRequestIds: result.clientRequestIds, queuedAtUtc: now() });
        return 'sent';
    } catch (error) {
        // Never into the pull (P9): the next pull asks again, and nothing was marked.
        console.warn(JSON.stringify({
            component: 'uploadHeldScheduleChoices',
            action: 'held_choices_not_uploaded_this_pull',
            reason: error instanceof Error ? error.message : String(error),
        }));
        return 'unavailable';
    }
}
