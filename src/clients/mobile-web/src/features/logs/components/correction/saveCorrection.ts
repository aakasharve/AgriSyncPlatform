/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane E1) — "जतन करा" on the "बदला" screen: the ONE edit path the
 * old form's Save used (`LogCommandService.updateLog` → `UpdateLog`), so the change becomes a new content version
 * through lane F1's `revise_log_content` (the server keeps every version, P3), labour goes as labour corrections, and
 * the honest words after an edit are the same (`buildEditSavedMessage`: what reached a server, what did not).
 * Nothing is written before this call, and a failure writes nothing (the record stays as it was; he can press again).
 */
import type { DailyLog, FarmerProfile } from '../../../../types';
import type { UpdateLogResponse } from '../../../../application/usecases/UpdateLog';
import { buildEditSavedMessage } from '../../../../app/helpers/saveToastMessages';
import type { Language } from '../../../../i18n/translations';

/** Recorded with the new version (server history, the phone's audit row) — never shown to the farmer. */
export const SPOKEN_CORRECTION_REASON = 'Spoken correction';

export interface SaveCorrectionDeps {
    updateLog: (logId: string, updates: Partial<DailyLog>, profile: FarmerProfile, reason: string) => Promise<UpdateLogResponse>;
    setHistory: (update: (prev: DailyLog[]) => DailyLog[]) => void;
    profile: FarmerProfile;
    language: Language;
    /** The app's toast (success / partial) — the same words the old form's edit said. */
    toast?: (message: string, type: 'success' | 'partial') => void;
}

/** What the save did: saved, or not — and when not, whether the labour numbers were part of it (they need the internet). */
export type SaveOutcome = { ok: true } | { ok: false; reason: 'labour' | 'other' };

export async function saveSpokenCorrection(deps: SaveCorrectionDeps, log: DailyLog, updates: Partial<DailyLog>): Promise<SaveOutcome> {
    // The labour route posts first and needs the network; a throw anywhere means nothing was written on this phone.
    const failed: SaveOutcome = { ok: false, reason: updates.labour ? 'labour' : 'other' };
    const result = await deps.updateLog(log.id, updates, deps.profile, SPOKEN_CORRECTION_REASON).catch(() => null);
    if (!result || !result.success || !result.log) return failed;
    const saved = result.log;
    deps.setHistory(prev => [saved, ...prev.filter(l => l.id !== log.id)]);
    const unsent = result.hasUnsentChanges ?? false;
    deps.toast?.(
        buildEditSavedMessage(result.persistedLabourCorrections ?? 0, deps.language, unsent, !(result.labourEngagementSetChanged ?? false)),
        unsent ? 'partial' : 'success',
    );
    return { ok: true };
}
