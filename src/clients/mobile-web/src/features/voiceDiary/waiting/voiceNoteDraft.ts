/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-59 = 3A) — an understood offline recording as
 * "तपासा आणि जतन करा" needs it: what Sathi understood, its provenance, the DAY it belongs to (the past day he chose before
 * speaking, else the day he spoke — never the day the internet came back), WHERE he chose before speaking (every crop and
 * plot; a recording kept before lane OF knows only its first plot), and the recording itself (so the save names and links
 * it). Pure.
 */
import type { AgriLogResponse, CropProfile, LogScope } from '../../../types';
import type { LogProvenance } from '../../../domain/ai/LogProvenance';
import type { VoiceRecordingRef } from '../../voice/useVoiceRecorder.types';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import {
    parsedLogOf, provenanceOf, resolveRecordedInstant, type UnreviewedAiResult,
} from '../../../infrastructure/sync/PendingAiResultsReader';

const FARM_GLOBAL = 'FARM_GLOBAL';
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface VoiceNoteDraft {
    draft: AgriLogResponse;
    provenance: LogProvenance;
    dayKey: string;
    /** Where he chose before speaking; null when it is no longer on the farm (he chooses it in the canonical steps). */
    scope: LogScope | null;
    recording: VoiceRecordingRef;
    typed: boolean;
}

/** The place kept with the recording, if it is still on the farm. */
export function scopeOfJob(job: UnreviewedAiResult, crops: readonly CropProfile[]): LogScope | null {
    const c = job.context;
    const cropIds = (c.scopeCropIds ?? []).filter(Boolean);
    const plotIds = (c.scopePlotIds ?? (c.plotId ? [c.plotId] : [])).filter(Boolean);
    if (cropIds.includes(FARM_GLOBAL) && plotIds.length === 0) {
        return { selectedCropIds: [FARM_GLOBAL], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
    }
    const known = plotIds.filter(id => crops.some(crop => crop.plots.some(p => p.id === id)));
    if (known.length === 0) return null;
    const ofCrops = crops.filter(crop => crop.plots.some(p => known.includes(p.id))).map(crop => crop.id);
    return { selectedCropIds: ofCrops, selectedPlotIds: known, mode: known.length > 1 ? 'multi' : 'single', applyPolicy: 'broadcast' };
}

/** The recording as the save names it: its clip key on this phone (audio), or a typed note's own moment. */
export function recordingOfJob(job: UnreviewedAiResult): VoiceRecordingRef {
    const typed = job.context.operation === 'text';
    const recordedAtUtc = job.context.recordedAtUtc ?? job.createdAt;
    return typed ? { recordedAtUtc, typed: true } : { recordedAtUtc, ...(job.context.idempotencyKey && { clipId: job.context.idempotencyKey }) };
}

/** The understood recording, ready to check and save; null when the job holds nothing to read (never fabricated). */
export function voiceNoteDraft(job: UnreviewedAiResult, crops: readonly CropProfile[]): VoiceNoteDraft | null {
    const draft = parsedLogOf(job);
    if (!draft) return null;
    const chosenDay = job.context.dateKey;
    return {
        draft,
        provenance: provenanceOf(job, draft),
        dayKey: chosenDay && DAY_KEY.test(chosenDay) ? chosenDay : getDateKey(resolveRecordedInstant(job)),
        scope: scopeOfJob(job, crops),
        recording: recordingOfJob(job),
        typed: job.context.operation === 'text',
    };
}
