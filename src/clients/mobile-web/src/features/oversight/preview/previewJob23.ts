/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 - DEV PREVIEW ONLY (reached only from `OversightAppPreview`, which `App.tsx` loads behind
 * `import.meta.env.DEV`). `&answer=job23` feeds the REAL server answer of the founder's first note (job_23d384ea: "05234 चं खत") through the
 * real path - normalise -> LogFactory -> buildDayView -> the saved screen - so the screen he complained about can be seen. It also gives the
 * place a long Marathi name, a completed pull, two older days with logs (so the month chip has a real number) and one clip on the phone
 * (so the player shows). `&nowork=1` uses `putPreviewClip` for the no-work card's unlinked clip. Nothing here is imported by the app.
 */
import { normalizeDriftedParsedLog } from '../../../infrastructure/ai/BackendAiClient.helpers';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { AgriLogResponse, CropProfile, DailyLog } from '../../../types';
import { publishPlaybackSwitch } from '../../logs/components/voiceResult/playbackSwitch';
import job from '../../logs/components/voiceResult/__tests__/fixtures/job_23d384ea.json';
import { buildPreviewV2EarlierLog } from './voiceFlowV2Fixtures';

const param = (name: string): string | null => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name));
export const isJob23 = (): boolean => param('answer') === 'job23';
export const isNoWork = (): boolean => param('nowork') === '1';

export const JOB23_PLOT_NAME = 'पाटील द्राक्ष बाग - मोठा प्लॉट उत्तर बाजू';

/** The seeded Grapes A under a long Marathi plot name. */
export const job23Crops = (crops: CropProfile[]): CropProfile[] =>
    crops.map(c => (c.id === 'crop-grapes' ? { ...c, plots: c.plots.map(p => (p.id === 'plot-grapes-a' ? { ...p, name: JOB23_PLOT_NAME } : p)) } : c));

/** The stored answer, as the app reads a parse answer (`normalizeDriftedParsedLog`). */
export const job23Draft = (): AgriLogResponse => normalizeDriftedParsedLog((job as { result: unknown }).result) as AgriLogResponse;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Logs of the same plot on two OTHER days of this month (today already holds the earlier recording): 3 days with logs in all. */
export function job23History(seed: readonly DailyLog[], today: string): DailyLog[] {
    const month = today.slice(0, 7);
    const others = [1, 2, 3, 4].map(d => `${month}-${pad(d)}`).filter(k => k !== today).slice(0, 2);
    const older = others.map((date, i) => ({ ...buildPreviewV2EarlierLog(today), id: `log-v2-older-${i}`, date }));
    return [...seed, ...older];
}

/** One second of silence as a WAV blob. */
function silentWav(): Blob {
    const rate = 8000, n = rate, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    return new Blob([buf], { type: 'audio/wav' });
}

/** A completed pull on this phone (the month chip's coverage rule). */
export async function putPreviewPull(): Promise<void> {
    await getDatabase().syncCursors.put({ tableName: 'shramsafal', lastSyncAt: new Date().toISOString(), version: 1 });
}

/** One clip row on the phone; linked to `dailyLogId` for a saved recording, unlinked for a no-work answer. Returns its id. */
export async function putPreviewClip(dailyLogId?: string): Promise<string> {
    publishPlaybackSwitch(true); // the preview has no consent server: the playback switch reads ON here (fresh, so no re-ask)
    const now = new Date().toISOString();
    const id = `preview-clip-${Date.now()}`;
    const blob = silentWav();
    await getDatabase().voiceClips.put({
        id, farmId: 'preview-farm', plotId: 'plot-grapes-a', recordedAtUtc: now, durationMs: 1000, mimeType: 'audio/wav', sizeBytes: blob.size, localBlob: blob,
        ...(dailyLogId && { dailyLogId }), status: 'parsed', retentionPolicy: 'processing_30d', expiresAtUtc: now, createdAt: now, updatedAt: now,
    } as never);
    return id;
}
