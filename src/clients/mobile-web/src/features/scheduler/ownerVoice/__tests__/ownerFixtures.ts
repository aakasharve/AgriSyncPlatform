// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b) - fixtures for the owner's-voice tests. The audio here is a GENERATED silence buffer (a tiny WAV header with no
// sound): never a voice, never shipped (it lives under the test folders only).
import { parseScheduleTask, type ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { shownDayOfStored, type DayCardsDetail } from '../../dayCards/dayCardsTypes';

export const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';
export const PLOT = 'a1a1a1a1-0000-4000-8000-0000000000a1';
export const CYCLE = 'c1c1c1c1-0000-4000-8000-0000000000c1';
export const V1 = 'd0d0d0d0-0000-4000-8000-0000000000a1';
export const V2 = 'd0d0d0d0-0000-4000-8000-0000000000a2';
export const CHAIN = 'e0e0e0e0-0000-4000-8000-0000000000e1';
export const USER = 'b0b0b0b0-0000-4000-8000-0000000000b1';
export const JOB = '90909090-0000-4000-8000-0000000000a1';

export const M_TIP = '11111111-0000-4000-8000-000000000001';
export const M_CHANGE = '11111111-0000-4000-8000-000000000002';
export const M_LOOK = '11111111-0000-4000-8000-000000000003';
export const C_TIP = '22222222-0000-4000-8000-000000000001';
export const C_CHANGE = '22222222-0000-4000-8000-000000000002';
export const C_LOOK = '22222222-0000-4000-8000-000000000003';
export const C_FOLLOW_1 = '22222222-0000-4000-8000-000000000004';
export const C_FOLLOW_2 = '22222222-0000-4000-8000-000000000005';

export const task = (over: Record<string, unknown>): ScheduleTaskContent => {
    const r = parseScheduleTask({ taskKey: 't', name: 'काम', kind: 'work', basis: 'stated', timing: { timer: 'day', fromDay: 10, toDay: 10, repeat: 'once' }, sources: [{ document: 'पुस्तिका' }], ...over });
    if (!r.ok) throw new Error(r.error);
    return r.value;
};

export const SPRAY_OLD = task({ taskKey: 'spray', name: 'फवारणी', kind: 'spray', dose: '२ ग्रॅम प्रति लिटर', products: [{ name: 'औषध अ', doseAsWritten: '२ ग्रॅम', unit: 'प्रति लिटर' }] });
export const SPRAY_NEW = task({ taskKey: 'spray', name: 'फवारणी (नवी)', kind: 'spray', dose: '३ ग्रॅम प्रति लिटर', products: [{ name: 'औषध ब', doseAsWritten: '३ ग्रॅम', unit: 'प्रति लिटर' }] });
export const DEW = task({ taskKey: 'dew', name: 'दव तपासणी', kind: 'observe', look: { where: 'पानांवर', sample: null, sign: null, threshold: null, ifThen: [] } });

export function detailOf(templateId: string, tasks: ScheduleTaskContent[], checked = true): DayCardsDetail {
    return {
        templateId, chainId: CHAIN, version: templateId === V2 ? 2 : 1, contentHash: `hash-${templateId}`, kind: 'reference', name: 'द्राक्ष', cropKey: 'grape',
        madeBy: { ownerType: 'INSTITUTION', label: 'संस्था' }, check: { state: checked ? 'Checked' : 'NotChecked', isChecked: checked, checkedBy: checked ? 'तपासनीस' : null, checkedAtUtc: null },
        stages: [{ index: 0, name: 'छाटणी', from: shownDayOfStored(0)!, to: shownDayOfStored(40)!, startSign: null, endSign: null }],
        tasks: tasks.map(t => ({ task: t, contentHash: 'x', shown: { from: shownDayOfStored(t.timing.fromDay), to: shownDayOfStored(t.timing.toDay), expectedFrom: null, expectedTo: null, repeatEnd: null }, doseChecked: checked })),
        challenges: [], skipped: 0,
    };
}

export const V1_DETAIL = detailOf(V1, [SPRAY_OLD, DEW]);
export const V2_DETAIL = detailOf(V2, [SPRAY_NEW]);

/** The shown day (day 1 = the start day) on which both works fall. */
export const SHOWN_DAY = 11;

export const message = (id: string, kind: 'tip' | 'change' | 'look', taskKey: string, clipId: string, over: Record<string, unknown> = {}) => ({
    id, chainId: CHAIN, scheduleVersionId: V1, taskKey, kind, clipId, sentAtUtc: '2026-11-20T06:00:00Z', ...over,
});
export const TIP = message(M_TIP, 'tip', 'spray', C_TIP);
export const CHANGE = message(M_CHANGE, 'change', 'spray', C_CHANGE, { newVersionId: V2, sentAtUtc: '2026-11-20T07:00:00Z' });
export const LOOK = message(M_LOOK, 'look', 'dew', C_LOOK, { answerFirst: 'दव आहे', answerSecond: 'दव नाही', followUpFirstClipId: C_FOLLOW_1, followUpSecondClipId: C_FOLLOW_2, sentAtUtc: '2026-11-20T08:00:00Z' });

export const clip = (id: string, hash = `hash-${id}`) => ({ id, chainId: CHAIN, mimeType: 'audio/wav', sizeBytes: 44, durationMs: 1000, contentHash: hash, createdAtUtc: '2026-11-20T05:00:00Z' });
export const ALL_CLIPS = [C_TIP, C_CHANGE, C_LOOK, C_FOLLOW_1, C_FOLLOW_2].map(id => clip(id));

export const state = (over: Record<string, unknown>) => ({
    id: `55555555-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`, farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, messageId: M_CHANGE, kind: 'accepted', sequence: 1,
    answer: null, itemId: null, itemCreated: false, jobId: null, byUserId: USER, atUtc: '2026-11-21T06:00:00Z', ...over,
});

/** A generated SILENCE buffer: a 44-byte WAV header and no samples. Not a voice. */
export function silence(): ArrayBuffer {
    const buf = new ArrayBuffer(44);
    const v = new DataView(buf);
    const w = (o: number, s: string) => { for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, 0, true);
    return buf;
}

/** Keeps the day-card copy of a version on the phone (what `loadDayCards` reads offline). */
export async function keepVersionCopy(detail: DayCardsDetail): Promise<void> {
    await getDatabase().scheduleDayCards.put({ templateId: detail.templateId, contentHash: detail.contentHash, fetchedAtUtc: '2026-11-20T00:00:00Z', detail: JSON.parse(JSON.stringify(detail)) });
}

/** A stand-in for the browser's audio element: it records what was played and lets a test end or stop a clip. */
export class FakeAudio {
    static all: FakeAudio[] = [];
    listeners = new Map<string, Array<() => void>>();
    src: string;
    played = 0;
    paused = false;
    constructor(src = '') { this.src = src; FakeAudio.all.push(this); }
    addEventListener(name: string, fn: () => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
    removeEventListener() { /* not needed */ }
    play() { this.played += 1; return Promise.resolve(); }
    pause() { this.paused = true; this.fire('pause'); }
    load() { /* nothing */ }
    fire(name: string) { (this.listeners.get(name) ?? []).forEach(fn => fn()); }
}
