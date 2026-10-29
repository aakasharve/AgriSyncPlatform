/**
 * spec: plr-d10 I26 — "who did which work" (founder D-34, PLR-D10 lane L3b).
 *
 * THE FOUNDER'S INVARIANT, verbatim in spirit (2026-10-27):
 *   Voice Log tells HOW MANY for each work.
 *   Hajeri tells WHO was present that day.
 *   Attribution tells WHO participated in WHICH work.
 *   None is allowed to silently overwrite another.
 *
 * Pure helpers for the per-work question "या N जणांमध्ये कोण होते?" under each
 * तपासा card. Nothing here writes anything and nothing here changes a count:
 *  - a work's N is READ from the farmer's own entry and only ever used to ask
 *    the question, to say how many are still anonymous, and to stop a name
 *    beyond N (the server refuses it too — never "fixed" by moving N, P7);
 *  - people named on another work of the SAME day are offered first — the
 *    system remembers the person, it does not assume the work;
 *  - people marked present in हजेरी that day are a SUGGESTION ONLY. Presence
 *    never creates a link: nothing here is ever passed to attach.
 */
import type { AttributedOperator, DailyLog } from '../../types';
import { resolveLabourHeadcount } from '../../domain/logs/labourHeadcount';
import type { LedgerRow } from './labour.types';
import { toMr } from './components/LabourDataPoints';

/** One work entry (a labour engagement) a farmer can name people on. */
export interface WorkTarget {
    labourAssignmentId: string;
    /** The work's stated headcount; `undefined` = nobody said how many (never 0-by-default, P4). */
    headcount?: number;
    /** Shown only when one log carries several works — the farmer's own plot name. */
    label?: string;
    /** The work's day, `yyyy-MM-dd` (the log's date). */
    date: string;
    /** Who the server says is named on this work right now (sync read-back). */
    attributed: AttributedOperator[];
}

/** A name given on this device in this sitting, before the next read-back. */
export interface SessionAttribution {
    labourAssignmentId: string;
    date: string;
    fieldOperatorId: string;
}

/**
 * PROPOSED Marathi (founder wording review), except `question`, which is the
 * founder's own sentence from D-34. Digits are Marathi to match the card's own
 * "६ जण" count directly above it.
 */
export const WORK_ATTRIBUTION_COPY = {
    question: (n: number) => `या ${toMr(n)} जणांमध्ये कोण होते?`,
    namedAndAnonymous: (named: number, anonymous: number) =>
        `${toMr(named)} जणांची नावं · ${toMr(anonymous)} अनामिक`,
    allNamed: (n: number) => `सगळ्या ${toMr(n)} जणांची नावं`,
    full: (n?: number) => (n == null
        ? 'या कामातल्या सगळ्या जणांची नावं आधीच झाली आहेत.'
        : `या कामात ${toMr(n)} जण होते — यापेक्षा जास्त नावं जोडता येत नाहीत.`),
    namedElsewhereChip: 'त्याच दिवशी दुसऱ्या कामात',
    presentChip: 'त्याच दिवशी हजेरीत',
} as const;

/** `ShramSafalErrors.AttributionExceedsHeadcount` — the server's refusal of a name beyond N (HTTP 409). */
export const ATTRIBUTION_EXCEEDS_HEADCOUNT_CODE = 'ShramSafal.Attribution.ExceedsHeadcount';

/** True when an attach failed because the work already carries N names — not a retryable failure. */
export function isOverHeadcountRefusal(error: unknown): boolean {
    const body = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data;
    return body?.error === ATTRIBUTION_EXCEEDS_HEADCOUNT_CODE;
}

const hasId = (id: unknown): id is string => typeof id === 'string' && id.length > 0;

/**
 * `dailyLogId -> the works on it a farmer can name people on`.
 *
 * - A stated 0 has nobody to name and gets no question (never "या ० जणांमध्ये").
 * - One work on the log: one question, no label (the card already says which work).
 * - Several works on one log: one question PER WORK, but only when the farmer
 *   can tell them apart — by his own plot name, else by a different N. Two works
 *   that read identically get NOTHING: attaching to the wrong one would invent
 *   attribution, which is worse than silence (P9 — silence, never a nag).
 */
export function buildWorkTargetsByLogId(history: readonly DailyLog[]): Map<string, WorkTarget[]> {
    const map = new Map<string, WorkTarget[]>();
    history.forEach((log) => {
        if (log.deletion) return;
        const works: WorkTarget[] = (log.labour ?? [])
            .filter((event) => hasId(event.labourAssignmentId))
            .map((event) => ({
                labourAssignmentId: event.labourAssignmentId as string,
                headcount: resolveLabourHeadcount(event),
                label: event.targetPlotName?.trim() || undefined,
                date: log.date,
                attributed: event.attributedOperators ?? [],
            }))
            .filter((work) => work.headcount !== 0);
        if (works.length === 0) return;
        if (works.length === 1) {
            map.set(log.id, [{ ...works[0], label: undefined }]);
            return;
        }
        const keys = works.map((w) => `${w.label ?? ''}|${w.headcount ?? '?'}`);
        const distinguishable = new Set(keys).size === keys.length
            && works.every((w) => w.label !== undefined || w.headcount !== undefined);
        if (distinguishable) map.set(log.id, works);
    });
    return map;
}

/**
 * People named on ANY OTHER work of `date` on this device's history, plus names
 * given in this sitting. Offered first on the next work of the day — remembered
 * as a person, never assumed into the work.
 */
export function namedOnDay(
    history: readonly DailyLog[],
    date: string,
    session: readonly SessionAttribution[],
    excludeAssignmentId: string,
): Set<string> {
    const ids = new Set<string>();
    history.forEach((log) => {
        if (log.deletion || log.date !== date) return;
        (log.labour ?? []).forEach((event) => {
            if (event.labourAssignmentId === excludeAssignmentId) return;
            (event.attributedOperators ?? []).forEach((op) => ids.add(op.fieldOperatorId));
        });
    });
    session.forEach((s) => {
        if (s.date === date && s.labourAssignmentId !== excludeAssignmentId) ids.add(s.fieldOperatorId);
    });
    return ids;
}

/**
 * People with a हजेरी mark of presence (full / half day, or night worked) on
 * `date` in the register on screen. A SUGGESTION for ordering and a quiet chip —
 * never a link: being present does not say which work (founder D-34).
 */
export function presentOnDay(
    ledger: { days?: readonly string[]; rows?: readonly LedgerRow[] } | undefined,
    date: string,
): Set<string> {
    const ids = new Set<string>();
    const index = ledger?.days?.indexOf(date) ?? -1;
    if (index < 0) return ids;
    (ledger?.rows ?? []).forEach((row) => {
        const cell = row.cells[index];
        if (cell && (cell.day === 'full' || cell.day === 'half' || cell.night === 'worked')) {
            ids.add(row.fieldOperatorId);
        }
    });
    return ids;
}

/**
 * The truthful state once at least one person is named (founder D-34: "Work
 * headcount = 6 · Known people = 3 · Still unidentified = 3"). `null` — nothing
 * shown — when nobody is named yet (a headcount-only card stays untouched, P9),
 * when no N was stated, or when more names exist than N (never a negative or
 * invented remainder, P4).
 */
export function attributionReadout(named: number, headcount: number | undefined): string | null {
    if (headcount == null || named <= 0 || named > headcount) return null;
    return named === headcount
        ? WORK_ATTRIBUTION_COPY.allNamed(headcount)
        : WORK_ATTRIBUTION_COPY.namedAndAnonymous(named, headcount - named);
}

/**
 * Orders picker rows for one work: people already named that day first, then
 * people marked present, then everyone else — by NAME GROUP, so two people who
 * share a name stay adjacent (the B2 collision must stay visible at the moment
 * of choosing). A group rises as far as its best member; order is otherwise kept.
 */
export function orderRowsForWork<T extends { operator: { id: string; displayName: string } }>(
    rows: readonly T[],
    namedIds: ReadonlySet<string>,
    presentIds: ReadonlySet<string>,
): T[] {
    const rank = (id: string): number => (namedIds.has(id) ? 0 : presentIds.has(id) ? 1 : 2);
    const groups = new Map<string, T[]>();
    rows.forEach((row) => {
        const key = row.operator.displayName.trim();
        const bucket = groups.get(key);
        if (bucket) bucket.push(row);
        else groups.set(key, [row]);
    });
    return [...groups.values()]
        .map((members, order) => ({ members, order, best: Math.min(...members.map((m) => rank(m.operator.id))) }))
        .sort((a, b) => a.best - b.best || a.order - b.order)
        .flatMap((g) => g.members);
}
