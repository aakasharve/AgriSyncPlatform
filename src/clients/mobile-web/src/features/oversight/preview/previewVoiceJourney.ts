/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 13b) — what the dev-only preview does when he stops the mic (or sends typed
 * words) with `VITE_VOICE_FLOW_V2=1`: there is no backend behind the preview, so this harness stands in for the voice
 * pipeline and the auto-save, and walks the SAME events the real save path emits (`voiceJourneySignal`, in the order
 * `BackendAiClient` → `useVoiceAutoSave` emit them) so the real step list ticks and the real result screen opens.
 *
 *   'processing' → kept → (1.2 s) understood → (0.6 s) placeChecked 'same' → the logs are built by the save's own
 *   factory (`LogFactory.createFromVoiceResult`) and stamped as the auto-save stamps them → added to the preview's
 *   in-memory history → (0.6 s) the result state → written → (a moment: where the real save queues for sync) → 'success'.
 *
 * The delays exist ONLY here: this file is imported by the preview alone, which `App.tsx` loads lazily behind
 * `import.meta.env.DEV`, so a production build drops it. Production ticks only on real events (P4).
 *
 * Honest by construction: nothing is queued for a server, so every log's `syncQueued` is `null` ("not known to be on its
 * way") — the result screen then offers no "पक्कं आहे" and says what it says for a record that is on the phone only.
 * Nothing is written to Dexie.
 */
import type { Dispatch, SetStateAction } from 'react';
import type { VoiceResultState } from '../../../app/hooks/useVoiceAutoSave';
import type { LastSavedLogSummaryItem } from '../../../app/uiRuntimeTypes';
import { markAutoSavedFromVoice } from '../../../app/helpers/autoSavedVoiceLog';
import { LogFactory } from '../../../core/domain/LogFactory';
import { noteVoiceJourney } from '../../../infrastructure/voice/voiceJourneySignal';
import type { AgriLogResponse, AppStatus, AudioData, CropProfile, DailyLog, FarmerProfile, LogScope } from '../../../types';
import { PREVIEW_V2_DRAFT } from './voiceFlowV2Fixtures';

/** How long the harness waits before each event after 'kept' (dev preview only; see the header). */
export const PREVIEW_JOURNEY_DELAYS_MS = { understood: 1200, placeChecked: 600, written: 600, success: 60 } as const;

export interface PreviewVoiceJourneyInput {
    input: 'audio' | 'text';
    /** The recording's length when known (shown as "N सेकंदांचा आवाज"). */
    durationMs?: number;
    scope: LogScope;
    crops: CropProfile[];
    profile: FarmerProfile;
    setStatus: (status: AppStatus) => void;
    setHistory: Dispatch<SetStateAction<DailyLog[]>>;
    setVoiceResult: (result: VoiceResultState) => void;
    setLastSaved: (ids: string[], summary: LastSavedLogSummaryItem[]) => void;
    /** Defaults to the fixture parse. */
    draft?: AgriLogResponse;
    /** Test seam: the pause between events. */
    wait?: (ms: number) => Promise<void>;
    /**
     * Dev preview only (`?preview=oversight&queued=1`): mark the logs as queued for the server, as the real save does on a
     * phone with a sync queue, so the saved screen's 30 s self-close can be seen. Default false: nothing is queued here.
     */
    simulateQueued?: boolean;
    /** Test seam: the clock. */
    now?: () => number;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

/** One summary row per log, as the real save fills it — with `syncQueued: null`, because nothing was queued here. */
const summaryOf = (logs: readonly DailyLog[], queued: boolean): LastSavedLogSummaryItem[] => logs.map(log => {
    const sel = log.context?.selection?.[0];
    return {
        logId: log.id,
        cropId: sel?.cropId,
        cropName: sel?.cropName ?? '',
        plotId: sel?.selectedPlotIds?.[0],
        plotName: sel?.selectedPlotNames?.[0] ?? '',
        count: 1,
        syncQueued: queued ? true : null,
    };
});

/** Walks one recording through the step list to the result screen. Resolves the logs it added to the history. */
export async function runPreviewVoiceJourney(run: PreviewVoiceJourneyInput): Promise<DailyLog[]> {
    const wait = run.wait ?? sleep;
    const now = run.now ?? Date.now;
    const draft = run.draft ?? PREVIEW_V2_DRAFT;

    run.setStatus('processing');
    noteVoiceJourney({ kind: 'kept', input: run.input, ...(run.durationMs && run.durationMs > 0 && { durationMs: run.durationMs }) }, now());
    await wait(PREVIEW_JOURNEY_DELAYS_MS.understood);
    noteVoiceJourney({ kind: 'understood', draft }, now());
    await wait(PREVIEW_JOURNEY_DELAYS_MS.placeChecked);
    noteVoiceJourney({ kind: 'placeChecked', result: 'same' }, now());

    const logs = LogFactory.createFromVoiceResult(draft, run.scope, run.crops, run.profile)
        .map(log => markAutoSavedFromVoice(log, { typed: run.input === 'text' }))
        .map(log => ({ ...log, meta: { ...log.meta, createdAtISO: log.meta?.createdAtISO ?? new Date(now()).toISOString(), createdByOperatorId: run.profile.activeOperatorId } }));
    run.setHistory(prev => [...logs, ...prev]);

    await wait(PREVIEW_JOURNEY_DELAYS_MS.written);
    const ids = logs.map(l => l.id);
    const unclear = (draft.unclearSegments ?? []).map(s => s.rawText?.trim() ?? '').filter(t => t.length > 0);
    run.setVoiceResult({ logIds: ids, clipId: null, key: `preview|${now()}`, unclear, written: logs, ...(run.input === 'text' && { typed: true }) });
    run.setLastSaved(ids, summaryOf(logs, run.simulateQueued === true));
    noteVoiceJourney({ kind: 'written', logIds: ids }, now());
    // The real save queues the logs for sync (a Dexie write) between the phone write and 'success', so the finished list
    // is drawn once before the result screen replaces it (and is then held, `holdOnScreen`). This pause stands in for it.
    await wait(PREVIEW_JOURNEY_DELAYS_MS.success);
    run.setStatus('success');
    return logs;
}

/** The length of a recording: what the recorder stated, else what the browser decodes (dev preview; never throws). */
export async function recordingMs(audio: AudioData | undefined): Promise<number | undefined> {
    if (!audio) return undefined;
    if (typeof audio.durationMs === 'number' && audio.durationMs > 0) return audio.durationMs;
    try {
        const Ctx = typeof window !== 'undefined' ? window.AudioContext : undefined;
        if (!Ctx || !audio.blob) return undefined;
        const ctx = new Ctx();
        try {
            const decoded = await ctx.decodeAudioData(await audio.blob.arrayBuffer());
            return Math.round(decoded.duration * 1000);
        } finally {
            void ctx.close().catch(() => undefined);
        }
    } catch {
        return undefined;
    }
}
