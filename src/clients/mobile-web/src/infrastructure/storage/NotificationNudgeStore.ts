/**
 * NotificationNudgeStore
 *
 * Synchronous localStorage adapter for session-independent notification nudge
 * flags. NotificationService is a module-level singleton and cannot use React
 * hooks, so raw storage stays isolated here.
 */

const DISCIPLINE_MORNING_ENABLED_KEY = 'shramsafal.enable_morning_rhythm_nudge';
const DISCIPLINE_SENT_PREFIX = 'shramsafal.nudge_sent';

export function wasDisciplineNudgeSent(id: string, dayKey: string): boolean {
    return window.localStorage.getItem(`${DISCIPLINE_SENT_PREFIX}.${id}.${dayKey}`) === '1';
}

export function markDisciplineNudgeSent(id: string, dayKey: string): void {
    window.localStorage.setItem(`${DISCIPLINE_SENT_PREFIX}.${id}.${dayKey}`, '1');
}

export function isMorningRhythmNudgeEnabled(): boolean {
    return window.localStorage.getItem(DISCIPLINE_MORNING_ENABLED_KEY) === 'true';
}

