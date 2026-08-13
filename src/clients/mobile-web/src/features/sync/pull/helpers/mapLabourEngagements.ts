/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LABOUR_PHASE2 Phase 3 — `LabourEngagementDto[]` (the wire) → `LabourEvent[]`
 * (what this device stores and every labour screen reads).
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 *
 * WHY THIS EXISTS. Labour was written and never read back. A farmer recorded 8
 * workers on Phone A; Phone B, freshly installed, saw the log with no labour on
 * it at all. This function is the half of that fix that runs on the phone.
 *
 * NOTHING HERE COUNTS, RESOLVES, DIVIDES OR DEFAULTS. Every value is copied
 * from the wire or omitted. The mirror of the server's single projection site
 * (`DtoMappingExtensions.ToDto(this LabourAssignment, …)`), which is also
 * copy-only, so a round trip cannot quietly change what the farmer said.
 *
 * ── THE THREE DECISIONS ──────────────────────────────────────────────────────
 *
 * 1. HEADCOUNT (doctrine P7). `workerCount` is the only headcount on the wire
 *    and it lands on exactly one local field, `count`. `attributedOperators`
 *    lands in its own field and is never counted, summed or compared against a
 *    headcount: eight workers with three people attributed is still eight.
 *    `null` means "we were not told" and becomes ABSENT, never 0 — an
 *    explicitly stated 0 stays 0 and stays distinguishable from silence, which
 *    is the distinction `LabourAssignmentFactory` preserved on the way up.
 *
 * 2. DURATION AND ITS BASIS (doctrine P8). `timeBasis` is carried ALWAYS;
 *    `durationHours` is carried ONLY when the basis is 'Explicit'. An Assumed
 *    duration is the server's own default, not something the farmer said, and
 *    `durationHours` is read everywhere on this client as a farmer statement —
 *    `buildLabourPayloads` forwards it as an Explicit time, `UpdateLog`'s
 *    `buildLabourCorrections` reads a change in it as a correction, and
 *    `DetailSheet` pre-selects the matching hour chip. None of them consult the
 *    basis. Writing an assumed 8 there would put back, inside the canonical
 *    record, the very constant Labour V1 Task 8.4 deleted from the two screens
 *    that rendered it as a measurement. So hours never travel here without
 *    their basis, and an assumed number never wears the costume of a stated
 *    one. Nothing is fabricated in the other direction either: 'Assumed' with
 *    no hours is the honest local shape for "the farmer did not say".
 *
 * 3. VOCABULARY. The server's enum NAMES map onto the local vocabulary the
 *    write path already sends, so a value that comes down goes back up meaning
 *    the same thing: `MapLabourEngagement`, `MapContractUnit` and
 *    `MapLabourShift` are TOTAL, case-insensitive maps, and each round trip
 *    below was checked against them. Anything unrecognised is DROPPED rather
 *    than guessed — a null contract unit is the same "not stated" the column
 *    already holds.
 *
 * @module features/sync/pull/helpers/mapLabourEngagements
 */

import type { AttributedOperator, LabourEvent } from '../../../../types';
import type { LabourEngagementDto } from '../../../../infrastructure/api/AgriSyncClient';
import { normalizeMojibakeText } from '../../../../shared/utils/textEncoding';

/**
 * A number the local record may hold, or `undefined` so the key is simply
 * absent. `null` on the wire is the server saying "we were not told", and
 * absence is how this client already spells that; `Number.isFinite` keeps a
 * NaN that survived a hand-edited fixture or a lenient JSON body out of a
 * canonical field.
 */
function statedNumber(value: number | null | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Trimmed text, or `undefined` — the wire says `null`, never `""`. */
function statedText(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? normalizeMojibakeText(trimmed) : undefined;
}

/**
 * `"Hired"` / `"Contract"` / `"Self"` → the local legacy triple, which is the
 * REQUIRED field on `LabourEvent` and the one `buildLabourPayloads` falls back
 * to (`event.engagementType || event.type`).
 *
 * Only `type` is set, never the richer B2.4 `engagementType`: the server stores
 * three values and B2.4 has four, so `'Self'` would have to pick between
 * `'self'` and `'exchange'` — a distinction the server already collapsed on the
 * way in. Re-inventing it here would assert something nobody said. `'HIRED'` for an
 * unrecognised value is not a guess either: it is byte-for-byte what
 * `MapLabourEngagement` will store for that same string on the way back up.
 */
function toLegacyType(engagementType: string): LabourEvent['type'] {
    switch (engagementType.trim().toLowerCase()) {
        case 'contract':
            return 'CONTRACT';
        case 'self':
            return 'SELF';
        default:
            return 'HIRED';
    }
}

/**
 * `"LumpSum"` → `'Lump Sum'`, and the other three verbatim. The local union
 * spells lump sum with a space and the server without one; `MapContractUnit`
 * accepts `"lump sum"`, `"lump_sum"` and `"lumpsum"` alike, so the round trip
 * is stable in both directions. Anything else is dropped — a unit this client
 * cannot represent is "not stated", never a substituted one.
 */
function toContractUnit(unit: string | null): LabourEvent['contractUnit'] | undefined {
    switch (unit?.trim().toLowerCase()) {
        case 'tree':
            return 'Tree';
        case 'acre':
            return 'Acre';
        case 'row':
            return 'Row';
        case 'lumpsum':
        case 'lump_sum':
        case 'lump sum':
            return 'Lump Sum';
        default:
            return undefined;
    }
}

/**
 * `"Explicit"` / `"Assumed"`, and nothing else.
 *
 * An unreadable basis is dropped together with the hours it belongs to, by the
 * caller below. That is the fail-safe direction: no basis means no duration is
 * carried, which is the same record as a farmer who said nothing about time.
 * The alternative — keeping hours whose provenance we cannot read — is the
 * precise failure P8 names.
 */
function toTimeBasis(timeBasis: string): LabourEvent['timeBasis'] | undefined {
    switch (timeBasis?.trim().toLowerCase()) {
        case 'explicit':
            return 'Explicit';
        case 'assumed':
            return 'Assumed';
        default:
            return undefined;
    }
}

/**
 * Attribution, in the order the server sent it (oldest attachment first —
 * `ToDto` orders by `CreatedAtUtc`). Order is part of the statement and is
 * never re-sorted here.
 *
 * A row missing either half is dropped: a name with no id cannot be corrected
 * or detached, and an id with no name has nothing to show the farmer. Dropping
 * it cannot change any reported quantity — that is `count`, above, and it is
 * copied, never counted from this list (P7).
 */
function toAttributedOperators(
    operators: LabourEngagementDto['attributedOperators'],
): AttributedOperator[] {
    return (operators ?? [])
        .filter(operator => operator?.fieldOperatorId && operator?.displayNameAtAttach)
        .map(operator => ({
            fieldOperatorId: operator.fieldOperatorId,
            displayNameAtAttach: normalizeMojibakeText(operator.displayNameAtAttach),
        }));
}

/**
 * ONE engagement, as this device will store it.
 *
 * `id` IS `labourAssignmentId` rather than a freshly minted local one. That is
 * deliberate and it is what makes a clean device usable: the engagement id is
 * the server primary key AND the key `ReviewSheet` resolves its attribution
 * picker through and `UpdateLog` builds its correction `before` map from. A
 * generated local id would be a second identity for one engagement, so the same
 * row pulled onto two devices would carry two — and minting an id is exactly
 * the kind of fabrication a read path must not do.
 */
function toLabourEvent(engagement: LabourEngagementDto): LabourEvent {
    const timeBasis = toTimeBasis(engagement.timeBasis);
    // P8, structurally: `durationHours` is written in the SAME object literal
    // as `timeBasis: 'Explicit'` and reachable no other way, so hours cannot
    // surface here without their basis, and an Assumed number cannot surface at
    // all.
    const explicitHours = timeBasis === 'Explicit' ? statedNumber(engagement.durationHours) : undefined;
    const contractUnit = toContractUnit(engagement.contractUnit);
    const task = statedText(engagement.task);
    const notes = statedText(engagement.notes);
    const shift = statedText(engagement.shift);
    const linkedActivityId = engagement.linkedActivityId ?? undefined;

    const maleCount = statedNumber(engagement.maleCount);
    const femaleCount = statedNumber(engagement.femaleCount);
    // THE headcount. One field in, one field out, no arithmetic in between.
    const count = statedNumber(engagement.workerCount);
    const wagePerPerson = statedNumber(engagement.wagePerPerson);
    const contractQuantity = statedNumber(engagement.contractQuantity);
    const totalCost = statedNumber(engagement.totalCost);

    return {
        id: engagement.labourAssignmentId,
        labourAssignmentId: engagement.labourAssignmentId,
        type: toLegacyType(engagement.engagementType),
        // Conditional spreads throughout, so a value the server did not state is
        // ABSENT rather than present-and-undefined — one uniform rule, and the
        // same one `buildLabourPayloads` follows on the way up.
        ...(count !== undefined && { count }),
        ...(maleCount !== undefined && { maleCount }),
        ...(femaleCount !== undefined && { femaleCount }),
        ...(wagePerPerson !== undefined && { wagePerPerson }),
        ...(contractUnit !== undefined && { contractUnit }),
        ...(contractQuantity !== undefined && { contractQuantity }),
        // NO-MULTIPLY (ADR 0023) survives the round trip untouched: this is the
        // engagement's own stated total, and nothing here derives one from a
        // rate and a headcount.
        ...(totalCost !== undefined && { totalCost }),
        ...(explicitHours !== undefined && { durationHours: explicitHours, timeBasis: 'Explicit' as const }),
        ...(explicitHours === undefined && timeBasis !== undefined && { timeBasis }),
        // The local field for a shift is `shiftId`, and the server's `"Full"` /
        // `"Half"` / `"Night"` are what `MapLabourShift` reads back
        // case-insensitively — so the word travels intact in both directions.
        // It will not match a farm's own configured shift ids, which is why
        // `DetailSheet`'s rate lookup simply finds nothing and derives nothing:
        // silence, not a wrong rate.
        ...(shift !== undefined && { shiftId: shift }),
        ...(task !== undefined && { activity: task }),
        ...(notes !== undefined && { notes }),
        ...(linkedActivityId !== undefined && { linkedActivityId }),
        // Never null on the wire; empty is a complete record, not a gap, and it
        // is stored as the empty array so "the server said nobody" and "the
        // server said nothing" stay different states locally too.
        workerNames: (engagement.workerNames ?? []).map(normalizeMojibakeText),
        attributedOperators: toAttributedOperators(engagement.attributedOperators),
    };
}

/**
 * Every engagement the response carried for one log, in the order it sent them.
 *
 * The caller decides whether this result may REPLACE what the device already
 * holds — see `preserveLocalOnlyFields` in `logsReconciler.ts`. This function
 * only answers "what did the server say".
 */
export function mapLabourEngagements(
    engagements: readonly LabourEngagementDto[],
): LabourEvent[] {
    return engagements.map(toLabourEvent);
}
