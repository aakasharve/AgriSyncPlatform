/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 2; founders D-92 / D-95) - his हो / नाही / फोटो answers, from the
 * pull onto the log record they are about (`DailyLog.inputIdentities`, non-indexed: Dexie is unchanged).
 *
 * WHY ITS OWN STEP. An answer is an append-only overlay that never moves its record's clock, so the record's delta cannot carry
 * it: the log reconciler's "nothing newer" skip would never see it. The answers come in their own list and are laid on the
 * record this phone already holds - after `reconcileLogs`, in the same transaction, so a first pull on a new phone (the same
 * response carries the records and their answers) restores them.
 *
 * RULES.
 *   - An answer is an OVERLAY (P7): only `log.inputIdentities` changes; every other field of the record, and its server stamp,
 *     are left exactly as they were.
 *   - The newest answer of each product AND speaker-or-check wins (the server already sends only the newest).
 *   - A row this phone made and has not seen come back (`pending`) is replaced by the server's row with the SAME assertion id
 *     (even when the server decided it was the check); a row newer than the pulled one of the same kind is kept - his last word
 *     is not undone by an older answer arriving late (P10).
 *   - A record this phone does not hold is skipped (the answer comes again when the record does).
 *   - Wire strings are read defensively: a row that is not the expected shape is dropped, never guessed at.
 */
import type { InputIdentityAnswer } from '../../../../domain/types/log.types';
import type { InputIdentityAssertionDto } from '../../../../infrastructure/api/dtos';
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

const VERDICTS = new Set<InputIdentityAnswer['verdict']>(['confirmed', 'rejected', 'photo']);

const asAnswer = (dto: InputIdentityAssertionDto): InputIdentityAnswer | null => {
    const verdict = typeof dto?.verdict === 'string' ? (dto.verdict.trim().toLowerCase() as InputIdentityAnswer['verdict']) : null;
    if (!dto || typeof dto.assertionId !== 'string' || typeof dto.dailyLogId !== 'string' || typeof dto.inputEventId !== 'string'
        || !Number.isInteger(dto.mixIndex) || !verdict || !VERDICTS.has(verdict) || typeof dto.assertedAtUtc !== 'string') {
        return null;
    }
    return {
        assertionId: dto.assertionId,
        inputEventId: dto.inputEventId,
        mixIndex: dto.mixIndex,
        verdict,
        ...(dto.catalogProductId ? { catalogProductId: dto.catalogProductId } : {}),
        ...(dto.attachmentId ? { attachmentId: dto.attachmentId } : {}),
        catalogVersion: typeof dto.catalogVersion === 'string' ? dto.catalogVersion : '',
        assertedByUserId: dto.assertedByUserId ?? null,
        assertedAtUtc: dto.assertedAtUtc,
        isCheck: dto.isCheck === true,
    };
};

const sameItem = (a: InputIdentityAnswer, b: InputIdentityAnswer): boolean =>
    a.inputEventId === b.inputEventId && a.mixIndex === b.mixIndex;

const ms = (iso: string): number => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
};

/** The answers a record holds once `incoming` (the server's rows for it) are laid on `held` (what the phone has). Pure. */
export function mergeInputIdentities(held: readonly InputIdentityAnswer[], incoming: readonly InputIdentityAnswer[]): InputIdentityAnswer[] {
    let out = [...held];
    for (const row of incoming) {
        // The server's copy of an answer this phone made: the pending row it stands for goes (same id), its kind and all.
        out = out.filter(h => h.assertionId !== row.assertionId);
        const sameKind = out.find(h => sameItem(h, row) && h.isCheck === row.isCheck);
        if (sameKind) {
            // A newer answer already held keeps the place; otherwise the newest of the two wins.
            if (ms(sameKind.assertedAtUtc) > ms(row.assertedAtUtc)) continue;
            out = out.filter(h => h !== sameKind);
        }
        out.push(row);
    }
    return inOrder(out);
}

/** A fixed order (oldest first, then by id), so the same set of answers is the same list however it was laid down. */
const inOrder = (rows: readonly InputIdentityAnswer[]): InputIdentityAnswer[] =>
    [...rows].sort((a, b) => ms(a.assertedAtUtc) - ms(b.assertedAtUtc) || a.assertionId.localeCompare(b.assertionId));

const sameRows = (a: readonly InputIdentityAnswer[], b: readonly InputIdentityAnswer[]): boolean =>
    a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));

/**
 * An answer the server turned down (its queue row is parked for review or discarded) is not an answer: its `pending` row is taken
 * off the record, so it does not show as his word for ever (lane IT4 fix 1, F4). There is no central hook for a refusal, so this
 * runs on every pull, before anything else; it costs one indexed read of the refused rows. A row still waiting or already
 * applied is left alone. Housekeeping: a failure here never fails the pull.
 */
export async function pruneRefusedAnswers(db: AgriLogDatabase): Promise<number> {
    try {
        const refused = (await db.mutationQueue.where('status').anyOf(['REJECTED_USER_REVIEW', 'REJECTED_DROPPED']).toArray())
            .filter(r => r.mutationType === SyncMutationName.AssertInputIdentity);
        const byLog = new Map<string, Set<string>>();
        for (const r of refused) {
            const p = r.payload as { assertionId?: unknown; dailyLogId?: unknown } | null;
            if (typeof p?.assertionId !== 'string' || typeof p.dailyLogId !== 'string') continue;
            byLog.set(p.dailyLogId, (byLog.get(p.dailyLogId) ?? new Set<string>()).add(p.assertionId));
        }
        let cleared = 0;
        for (const [logId, ids] of byLog) {
            const record = await db.logs.get(logId);
            const held = record?.log.inputIdentities ?? [];
            const kept = held.filter(a => !(a.pending === true && ids.has(a.assertionId)));
            if (!record || kept.length === held.length) continue;
            await db.logs.update(logId, { log: { ...record.log, inputIdentities: kept } });
            cleared += 1;
        }
        return cleared;
    } catch (error) {
        console.warn('inputIdentityReconciler: could not clear refused answers this time', error);
        return 0;
    }
}

/**
 * Lays the pulled answers on the records this phone holds. Must run inside the orchestrator's transaction, after the logs are
 * reconciled. Returns how many records were changed.
 */
export async function reconcileInputIdentityAnswers(db: AgriLogDatabase, payload: SyncPullResponse): Promise<number> {
    await pruneRefusedAnswers(db);
    const rows = Array.isArray(payload.inputIdentityAssertions) ? payload.inputIdentityAssertions : [];
    if (rows.length === 0) return 0;

    const byLog = new Map<string, InputIdentityAnswer[]>();
    for (const dto of rows) {
        const answer = asAnswer(dto);
        if (!answer) continue;
        byLog.set(dto.dailyLogId, [...(byLog.get(dto.dailyLogId) ?? []), answer]);
    }

    let changed = 0;
    for (const [logId, answers] of byLog) {
        const record = await db.logs.get(logId);
        if (!record) continue;
        const held = record.log.inputIdentities ?? [];
        const next = mergeInputIdentities(held, [...answers].sort((a, b) => ms(a.assertedAtUtc) - ms(b.assertedAtUtc)));
        if (sameRows(inOrder(held), next)) continue;
        // Only this field: the record's other fields and its server stamp stay as they are (P7).
        await db.logs.update(logId, { log: { ...record.log, inputIdentities: next } });
        changed += 1;
    }
    return changed;
}
