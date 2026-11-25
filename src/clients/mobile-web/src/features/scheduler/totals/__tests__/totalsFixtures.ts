// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, phone half) - the server's answers as fixtures: one with EVERY field, one with the small-group nulls, a sample, an own schedule.
export const SCHED_A = '10000000-0000-4000-8000-00000000000a';
export const SCHED_B = '10000000-0000-4000-8000-00000000000b';
export const CHAIN_A = '10000000-0000-4000-8000-0000000000c1';

export const FULL_ANSWER = {
    scheduleId: SCHED_A, chainId: CHAIN_A, kind: 'totals', minimumFarmers: 5,
    following: 37, having: 52, worksTaken: 11, worksInSchedule: 24, worksTakenPercent: 46,
    works: [{ taskKey: 'spray-1', name: 'Bud spray', farmers: 29 }, { taskKey: 'irr-2', name: 'Drip irrigation', farmers: 8 }],
    doneJobs: 19, heard: 14, checkedVersionId: SCHED_A,
};
export const NULL_ANSWER = {
    scheduleId: SCHED_B, chainId: null, kind: 'totals', minimumFarmers: 5,
    following: null, having: null, worksTaken: null, worksInSchedule: 24, worksTakenPercent: null, works: [], doneJobs: null, heard: null, checkedVersionId: SCHED_B,
};
export const SAMPLE_ANSWER = { ...NULL_ANSWER, kind: 'sample', worksInSchedule: null, checkedVersionId: null };
export const OWN_ANSWER = { ...NULL_ANSWER, kind: 'own', worksInSchedule: null, checkedVersionId: null };

export const json = (status: number, body?: unknown) => async () => new Response(body === undefined ? null : JSON.stringify(body), { status });
export const setOnline = (online: boolean) => Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
