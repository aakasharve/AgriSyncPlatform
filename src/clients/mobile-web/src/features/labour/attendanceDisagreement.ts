/**
 * Labour V2 R1 Task 3.3 (controller-ruled scope extension) — headcount
 * disagreement detection, and the gate that keeps rung 4's one-tap बरोबर
 * unreachable while a conflict stands.
 *
 * The class of fact handled here: the farmer's spoken statement disagrees
 * with what is already known — the anchored log said 12 and speaking produced
 * 10, or the count (spoken OR anchored) says 0 while people are named as
 * present. One class, every extreme included. Rule 1: BOTH statements are
 * preserved, nothing is silently overwritten. D9.5 / founder §8: the conflict
 * is VISIBLE inside the existing confirm and settles at the SAME
 * बरोबर / बदल करा — one question, never a separate blocking one.
 *
 * BINDING CONTRACT FOR TASK 3.4b (the renderer):
 *  - Rung 4 renders `selectConfirmSurface(...)`, never a bare confirm: the
 *    'confirm' kind is UNDERIVABLE while a disagreement stands, so the
 *    one-tap बरोबर cannot exist without the conflict being shown.
 *  - 'confirm-with-disagreement' renders BOTH statements (`sourceText` +
 *    `systemInterpretation`, the D9.5 provenance chips) inside the confirm.
 *  - बरोबर accepts the spoken statement AS ITS OWN RECORD (3.4b's save);
 *    the anchored engagement is NEVER mutated by this flow. बदल करा corrects
 *    the reading. The owner sees both statements in तपासा.
 *
 * This is the fact-1 sibling of `attendanceContradiction.ts` (fact 2, the
 * mark-plane पूर्ण/अर्धा question). Two distinct facts, two files — the doc
 * says do not conflate them, so they are not.
 *
 * Deterministic, never AI-produced: it compares two things the farmer already
 * said. Silence makes no claim — an unstated count is unknown, never zero
 * (rule 3), so it can never manufacture a disagreement.
 */
import type { LabourEvent } from '../../domain/types/log.labour.types';
import { resolveLabourHeadcount } from '../../domain/logs/labourHeadcount';
import type { LabourAnchor } from './labourAnchor';

export type HeadcountConflictAxis = 'spoken-vs-anchor' | 'count-vs-composition';

/** One spoken statement, verbatim — the transparency fields exactly as parsed. */
export interface SpokenStatement {
    sourceEventId: string;
    count?: number;
    sourceText?: string;
    systemInterpretation?: string;
}

export interface HeadcountDisagreement {
    /** WHAT disagrees — non-empty by construction. */
    axes: readonly HeadcountConflictAxis[];
    /** The log's standing statement — preserved verbatim; this flow never mutates it. */
    anchored: { headcount: number; logId: string } | null;
    /** What speaking produced — preserved verbatim; lands as its own record at save. */
    spoken: { count: number | null; statements: readonly SpokenStatement[] };
    /**
     * People named as present, duplicates collapsed by EXACT string so a
     * repeated name can neither hide nor fabricate a disagreement (carried
     * 3.2-review minor). Not identity resolution — rule 10 lives at
     * resolution, never here.
     */
    uniqueNames: readonly string[];
    /** The count the confirm asks the farmer to accept (spoken ?? anchored — the ladder's twin). */
    governingCount: number;
}

export interface DisagreementInput {
    /** Task 3.1's resolved anchor for today. */
    anchor: LabourAnchor;
    /** The parse's labour events — the spoken statement(s). */
    events: readonly LabourEvent[];
}

export function findHeadcountDisagreement({ anchor, events }: DisagreementInput): HeadcountDisagreement | null {
    const anchored = anchor.state === 'anchored'
        ? { headcount: anchor.headcount, logId: anchor.logId }
        : null;

    // Spoken count: the canonical per-event derivation, summed. All-unstated
    // (or no events) is null — labour spoken of with no number is unknown,
    // NOT zero (rule 3); silence must never manufacture a "0" statement.
    const perEvent = events.map((e) => resolveLabourHeadcount(e));
    const stated = perEvent.filter((n): n is number => n != null);
    const spokenCount = stated.length === 0 ? null : stated.reduce((a, b) => a + b, 0);

    const rawNames = events.flatMap((e) => e.workerNames ?? []);
    const uniqueNames = [...new Set(rawNames)];

    const statements: SpokenStatement[] = [];
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const count = perEvent[i];
        if (count == null && (event.workerNames?.length ?? 0) === 0) continue; // says nothing countable
        statements.push({
            sourceEventId: event.id,
            ...(count != null ? { count } : {}),
            ...(event.sourceText != null ? { sourceText: event.sourceText } : {}),
            ...(event.systemInterpretation != null
                ? { systemInterpretation: event.systemInterpretation }
                : {}),
        });
    }

    const axes: HeadcountConflictAxis[] = [];
    if (spokenCount != null && anchored != null && spokenCount !== anchored.headcount) {
        axes.push('spoken-vs-anchor');
    }

    // The count the confirm would ask the farmer to accept — same precedence
    // as selectLadderRung (spoken wins for selection; storage keeps both).
    const governingCount = spokenCount ?? anchored?.headcount ?? null;
    if (governingCount != null) {
        if (uniqueNames.length > governingCount) {
            // More people named as present than counted — 0-with-names is this
            // at the extreme (the controller-ruled case).
            axes.push('count-vs-composition');
        } else if (rawNames.length >= governingCount && uniqueNames.length < governingCount) {
            // Raw length would satisfy rung 4 while the actual composition is
            // short — only duplicates can produce this, and a duplicated name
            // must not mask a disagreement (carried minor). A plain subset
            // (raw < governing) is P7-normal: rung 3 asks the remainder.
            axes.push('count-vs-composition');
        }
    }

    if (axes.length === 0 || governingCount == null) return null;
    return {
        axes,
        anchored,
        spoken: { count: spokenCount, statements },
        uniqueNames,
        governingCount,
    };
}

/**
 * The rung-4 surface. BOTH kinds are the confirm — settled by बरोबर / बदल करा
 * (D9.5: the interpretation is visible inside it, never a separate blocking
 * question). There is deliberately no third kind: with a disagreement standing,
 * a conflict-free confirm cannot be derived from this function, which is what
 * makes the one-tap बरोबर unreachable without the conflict being shown.
 */
export type AttendanceConfirmSurface =
    | { kind: 'confirm' }
    | { kind: 'confirm-with-disagreement'; disagreement: HeadcountDisagreement };

export function selectConfirmSurface(input: DisagreementInput): AttendanceConfirmSurface {
    const disagreement = findHeadcountDisagreement(input);
    return disagreement === null
        ? { kind: 'confirm' }
        : { kind: 'confirm-with-disagreement', disagreement };
}
