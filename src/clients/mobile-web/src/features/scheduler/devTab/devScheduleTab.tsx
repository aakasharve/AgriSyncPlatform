// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10) - Vite DEV server only. Seeds this browser's Dexie with a 14-plot farm (G1..G14), the schedules, the day-card
// copies, the switch and the subscriptions, then draws the REAL SchedulerPage for one seat (`?role=owner|mukadam|worker`). It is a QA page, not part of the app.
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../../../index.css';
import SchedulerPage from '../../../pages/SchedulerPage';
import { setScheduleTemplatesFromReferenceData } from '../../../infrastructure/reference/TemplateCatalog';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SCHEDULE_MECHANISM_META_ROW } from '../../../core/session/scheduleMechanism';
import { parseScheduleTask } from '../../../../../../../sync-contract/schemas/schedule-task.zod';
import { addDays } from '../schedulePage/scheduleDates';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import type { CropProfile, Plot } from '../../../types';

const FARM = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const cyc = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = { checked: '10000000-0000-4000-8000-0000000000a1', second: '10000000-0000-4000-8000-0000000000b2', unchecked: '10000000-0000-4000-8000-0000000000c3' };
const pid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const params = new URLSearchParams(window.location.search);
const role = (params.get('role') ?? 'owner') as 'owner' | 'mukadam' | 'worker';
const todayKey = getDateKey();
const ref = addDays(todayKey, -9); // stored day 9 today, printed as day 10

const task = (taskKey: string, name: string, kind: string, from: number, extra: Record<string, unknown> = {}) => {
    const r = parseScheduleTask({ taskKey, name, kind, basis: 'stated', timing: { timer: 'day', fromDay: from, toDay: from, repeat: 'once' }, sources: [{ document: 'ICAR-NRCG ची प्रकाशनं', page: '१२' }], products: kind === 'spray' ? [{ name: 'औषध', dose: '२ ग्रॅम', per: 'लिटर' }] : [], ...extra });
    if (!r.ok) throw new Error(r.error);
    return r.value;
};
const shown = (stored: number) => ({ stored, shown: stored >= 0 ? stored + 1 : null, daysBeforeStart: stored < 0 ? -stored : null });
const detail = (id: string, name: string, checked: boolean, tasks: ReturnType<typeof task>[]) => ({
    templateId: id, chainId: null, version: 1, contentHash: `h-${id}`, kind: 'reference', name, cropKey: 'grape',
    madeBy: { ownerType: 'INSTITUTION', label: 'श्रमसफल' }, check: { state: checked ? 'Checked' : 'NotChecked', isChecked: checked, checkedBy: checked ? 'श्रमसफल कृषी तज्ज्ञ' : null, checkedAtUtc: null },
    stages: [{ index: 0, name: 'छाटणीनंतर', from: shown(0), to: shown(40), startSign: null, endSign: null }],
    tasks: tasks.map(t => ({ task: t, contentHash: 'x', shown: { from: shown(t.timing.fromDay ?? 0), to: shown(t.timing.toDay ?? 0), expectedFrom: null, expectedTo: null, repeatEnd: null }, doseChecked: checked })),
    challenges: [], skipped: 0,
});

const tplRow = (id: string, name: string, extra: Record<string, unknown>) => ({
    id, name, cropType: 'Grapes', totalDays: 40, versionHash: 'h', hasStoredDays: true, ownerType: 'INSTITUTION', sourceLabel: 'ICAR-NRCG ची प्रकाशनं',
    stages: [{ name: 'Post Pruning', startDay: 0, endDay: 39 }],
    activities: [{ name: 'Drip irrigation', category: 'Irrigation', stageName: 'Post Pruning', startDay: 0, endDay: 39, frequencyMode: 'every_n_days', intervalDays: 3 }], ...extra,
});

async function seed(): Promise<CropProfile[]> {
    const checkedBy = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
    setScheduleTemplatesFromReferenceData([
        tplRow(T.checked, 'Grapes - Pruning to Pruning', { check: checkedBy }),
        tplRow(T.second, 'Grapes - Expert Schedule', { ownerType: 'EXPERT', sourceLabel: 'GAP २०१३', check: checkedBy }),
        tplRow(T.unchecked, 'Grapes - Advisor Sample', { ownerType: 'EXPERT', sourceLabel: 'TB-८ २००७', check: null }),
    ] as never);
    const db = getDatabase();
    const spray = (from: number) => task('spray-1', 'फवारणी १', 'spray', from);
    const look = task('bud-look', 'कळ्या तपासणी', 'observe', 9, { ask: { question: 'किती कळ्या फुटल्या, किती फक्त फुगल्या?', answers: [] }, look: { sign: 'फुगलेली कळी' } });
    const details = [
        detail(T.checked, 'द्राक्ष — फळछाटणी ते फळछाटणी', true, [spray(12), look, task('water-1', 'पाणी देणे', 'irrigation', 15)]),
        detail(T.second, 'तज्ज्ञ', true, [spray(14)]),
        detail(T.unchecked, 'सल्लागार (नमुना)', false, [spray(12)]),
    ];
    await db.scheduleDayCards.bulkPut(details.map(d => ({ templateId: d.templateId, contentHash: d.contentHash, fetchedAtUtc: new Date().toISOString(), detail: d })));
    await db.appMeta.put({ key: SCHEDULE_MECHANISM_META_ROW, value: { receivedAtUtc: new Date().toISOString(), farmIds: [FARM] }, updatedAt: new Date().toISOString() } as never);
    await db.cropCycles.bulkPut(Array.from({ length: 14 }, (_, i) => ({ id: cyc(i + 1), plotId: pid(i + 1), payload: { id: cyc(i + 1), plotId: pid(i + 1), farmId: FARM, cropName: 'Grapes', startDate: ref, modifiedAtUtc: '2026-08-01T00:00:00.000Z' }, modifiedAtUtc: '2026-08-01T00:00:00.000Z' })) as never);
    const sub = (n: number, plot: number, template: string, extra: Record<string, unknown> = {}) => ({
        id: `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`, farmId: FARM, plotId: pid(plot), cropCycleId: cyc(plot), templateId: template, referenceDate: null, state: 'Active',
        adoptedAtUtc: '2026-10-02T00:00:00Z', origin: 'Outside', checkState: 'Checked', slot: 1, isMain: true, ...extra,
    });
    await db.scheduleSubscriptions.bulkPut([
        sub(1, 1, T.checked), sub(2, 2, T.checked), sub(3, 2, T.second, { slot: 2, isMain: false }), sub(4, 3, T.unchecked, { checkState: 'NotChecked' }),
    ] as never);
    const plots: Plot[] = Array.from({ length: 14 }, (_, i) => ({
        id: pid(i + 1), name: `G${i + 1}`, startDate: ref, baseline: {} as Plot['baseline'],
        schedule: { id: `sch-${i + 1}`, plotId: pid(i + 1), templateId: T.checked, referenceType: 'PRUNING', referenceDate: ref, stageOverrides: [], expectationOverrides: [] },
    })) as Plot[];
    const mine = role === 'owner' ? plots : role === 'mukadam' ? plots.slice(0, 8) : plots.slice(0, 3);
    return [{ id: 'crop-1', name: 'Grapes', iconName: 'grape', color: 'green', plots: mine, activeScheduleId: null, supportedTasks: [], workflow: [] } as unknown as CropProfile];
}

const App: React.FC = () => {
    const [crops, setCrops] = useState<CropProfile[] | null>(null);
    useEffect(() => { void seed().then(setCrops); }, []);
    if (!crops) return null;
    const owner = role === 'owner';
    const mukadam = role === 'mukadam';
    return (
        <SchedulerPage crops={crops} logs={[]} tasks={[]} onUpdateCrops={setCrops} onBack={() => undefined}
            takeFarmId={FARM} takeUserId={USER}
            mayMakeOwnSchedule={owner} mayPlanWork={owner || mukadam} mayAssignWork={owner || mukadam} onMakeOwnSchedule={() => undefined} />
    );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
