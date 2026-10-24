/**
 * Labour V2 R1 Task 3.2 — the adaptive ladder (founder D1–D3, locked as drawn).
 *
 * A pure function: the rung is derived from what is ALREADY KNOWN, so the
 * screen can only ever ask for the facts it is missing (trust rule 15 — never
 * make the farmer answer questions the database wants). The spoken count wins
 * for RUNG SELECTION only; storage keeps both statements (Task 3.3).
 */
export type LadderRung = 1 | 2 | 3 | 4;

export interface LadderInput {
    /** Today's accepted engagement headcount — resolveLabourAnchor().headcount. */
    anchorHeadcount: number | undefined;
    /** resolveLabourHeadcount over the parse's labour events, undefined when unstated. */
    spokenCount: number | undefined;
    /** The people named as present, each exactly as spoken. */
    workerNames: readonly string[];
}

export function selectLadderRung({ anchorHeadcount, spokenCount, workerNames }: LadderInput): LadderRung {
    const known = spokenCount ?? anchorHeadcount;
    if (known == null) return 1;
    // Review finding N2: an explicitly STATED zero (0 is reserved for genuine
    // no-labour — LabourDataDto.Headcount) means Labour has nothing to verify.
    // Asks nothing; rungWho(0) must never render. "People came but no work"
    // belongs to Phase 4's no-work-day door, not this ladder.
    if (known === 0 && workerNames.length === 0) return 1;
    if (workerNames.length === 0) return 2;
    if (workerNames.length < known) return 3;
    return 4;
}
