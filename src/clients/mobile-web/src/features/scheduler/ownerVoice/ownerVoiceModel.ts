// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b) - what the owner's voice means for ONE plot, as pure functions over what this phone holds. Nothing here reads
// storage or draws anything. A decision or an answer is shown as TAKEN only from a server row; an act still in the outbox is `queued` and is said to be waiting (P10).
import type { CardPart } from '../dayCards/dayCardsModel';
import type { DayCardsDetail } from '../dayCards/dayCardsTypes';
import type { OwnerAnswer, OwnerMessage, OwnerMessageState, OwnerVoiceView } from './ownerVoiceTypes';

export type StandingKind = 'none' | 'accepted' | 'kept_old' | 'taken_back';
export interface Standing {
    kind: StandingKind;
    /** True when this is only an act waiting in the outbox: the server has not confirmed it. */
    queued: boolean;
}

const DECISION_KINDS = new Set(['accepted', 'kept_old', 'taken_back']);
const DECISION_OF = { accept: 'accepted', keep_old: 'kept_old', take_back: 'taken_back' } as const;

/** The server's standing decision row of one plot-season and message: the HIGHEST sequence wins. */
export function standingRow(states: readonly OwnerMessageState[], plotId: string, cropCycleId: string | null, messageId: string): OwnerMessageState | null {
    let best: OwnerMessageState | null = null;
    for (const s of states) {
        if (s.plotId !== plotId || s.messageId !== messageId || !DECISION_KINDS.has(s.kind)) continue;
        if (cropCycleId !== null && s.cropCycleId !== cropCycleId) continue;
        if (!best || s.sequence > best.sequence) best = s;
    }
    return best;
}

/** Where the decision on a change stands: an act waiting in the outbox (the newest one) is shown as waiting, else the server's standing row. */
export function standingOf(view: OwnerVoiceView, plotId: string, cropCycleId: string | null, messageId: string): Standing {
    const waiting = [...view.queued].reverse().find(q => q.kind === 'decide' && q.plotId === plotId && q.messageId === messageId && q.decision);
    if (waiting?.decision) return { kind: DECISION_OF[waiting.decision], queued: true };
    const row = standingRow(view.states, plotId, cropCycleId, messageId);
    return { kind: row ? (row.kind as StandingKind) : 'none', queued: false };
}

export interface AnswerStanding { answer: OwnerAnswer | null; queued: boolean }

/** The look's answer: the server's (the first is kept), else the one waiting in the outbox. */
export function answerOf(view: OwnerVoiceView, plotId: string, messageId: string): AnswerStanding {
    const row = view.states.find(s => s.kind === 'answered' && s.plotId === plotId && s.messageId === messageId);
    if (row?.answer) return { answer: row.answer, queued: false };
    const waiting = view.queued.find(q => q.kind === 'answer' && q.plotId === plotId && q.messageId === messageId && q.answer);
    return waiting?.answer ? { answer: waiting.answer, queued: true } : { answer: null, queued: false };
}

/** Heard on this plot: a server row, or the heard act already waiting in the outbox (so a second full play queues nothing). */
export function isHeard(view: OwnerVoiceView, plotId: string, messageId: string): boolean {
    return view.states.some(s => s.kind === 'heard' && s.plotId === plotId && s.messageId === messageId)
        || view.queued.some(q => q.kind === 'heard' && q.plotId === plotId && q.messageId === messageId);
}

/** The messages of the given schedule versions this plot has not heard, oldest first. */
export function unheardFor(view: OwnerVoiceView, plotId: string, versionIds: readonly string[]): OwnerMessage[] {
    const versions = new Set(versionIds);
    return view.messages
        .filter(m => versions.has(m.scheduleVersionId) && !isHeard(view, plotId, m.id))
        .sort((a, b) => Date.parse(a.sentAtUtc) - Date.parse(b.sentAtUtc));
}

/** "N आवाज" per schedule version, for the tiles: only versions with at least one unheard message are listed. */
export function unheardCounts(view: OwnerVoiceView, plotId: string, versionIds: readonly string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const m of unheardFor(view, plotId, versionIds)) out[m.scheduleVersionId] = (out[m.scheduleVersionId] ?? 0) + 1;
    return out;
}

/** The message whose STANDING decision on some plot is "accepted" and names this job: its clip travels with the job. Server rows only. */
export function acceptedMessageForJob(view: OwnerVoiceView, jobId: string): { message: OwnerMessage; state: OwnerMessageState } | null {
    for (const s of view.states) {
        if (s.kind !== 'accepted' || s.jobId !== jobId) continue;
        const standing = standingRow(view.states, s.plotId, s.cropCycleId, s.messageId);
        if (!standing || standing.id !== s.id) continue;
        const message = view.messages.find(m => m.id === s.messageId);
        if (message) return { message, state: s };
    }
    return null;
}

/** The tips of one work of one version (a play button on its card). */
export function tipsOfTask(messages: readonly OwnerMessage[], versionId: string, taskKey: string): OwnerMessage[] {
    return messages.filter(m => m.kind === 'tip' && m.scheduleVersionId === versionId && m.taskKey === taskKey)
        .sort((a, b) => Date.parse(a.sentAtUtc) - Date.parse(b.sentAtUtc));
}

/**
 * Lays the owner's cards into a deck the day-card model made: a CHANGE is its own card FIRST in the day (right after the day card, which only says what the day holds;
 * before every work card), a LOOK is its own card right AFTER its work's first card. A message about a work that is not in this deck makes no card. Tips make no card: they
 * are a play button on the work's own card.
 */
export function withOwnerCards(parts: readonly CardPart[], detail: DayCardsDetail, messages: readonly OwnerMessage[]): CardPart[] {
    const mine = messages.filter(m => m.scheduleVersionId === detail.templateId && (m.kind === 'change' || m.kind === 'look'))
        .sort((a, b) => Date.parse(a.sentAtUtc) - Date.parse(b.sentAtUtc));
    if (mine.length === 0) return [...parts];
    const heroOf = (key: string) => parts.find((p): p is Extract<CardPart, { type: 'hero' }> => p.type === 'hero' && p.task.task.taskKey === key);
    const changes: CardPart[] = [];
    const looksAfter = new Map<string, CardPart[]>();
    for (const m of mine) {
        const hero = heroOf(m.taskKey);
        if (!hero) continue;
        if (m.kind === 'change') changes.push({ type: 'ownerChange', message: m, task: hero.task });
        else looksAfter.set(m.taskKey, [...(looksAfter.get(m.taskKey) ?? []), { type: 'ownerLook', message: m, task: hero.task }]);
    }
    const out: CardPart[] = [];
    let placed = false;
    const placeChanges = () => { if (!placed) { out.push(...changes); placed = true; } };
    for (const p of parts) {
        if (p.type !== 'day') placeChanges();
        out.push(p);
        if (p.type === 'hero') out.push(...(looksAfter.get(p.task.task.taskKey) ?? []));
    }
    placeChanges();
    return out;
}
