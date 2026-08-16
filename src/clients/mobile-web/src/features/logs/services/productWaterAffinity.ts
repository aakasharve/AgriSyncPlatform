/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * productWaterAffinity — the client mirror of
 * `ShramSafal.Domain.Dfes.ProductWaterAffinity` (founder decision 14, 2026-08-16).
 *
 * WHETHER A PRODUCT OWES THE WATER/CARRIER QUESTION IS DECIDED FROM THE PRODUCT,
 * NEVER FROM `inputs[].method`.
 *
 * The founder's words: "it must understand from the word, or not flagging it anywhere,
 * but keep that fertilizer name — such as a farmer might say '0 52 34 दिल', that means an
 * NPK grade that is given. We already made the AI intelligent enough, don't just confuse
 * it." Follow-up ruling: `fertiliser rule = dry granular`.
 *
 * WHY THIS FILE EXISTS AT ALL. `scoreVlog.ts` runs offline in the browser and cannot call
 * the server, so the rule has to exist on both sides. The two copies are pinned against
 * each other by `productWaterAffinity.parity.test.ts`, which parses the C# source the same
 * way `dfesTuning.test.ts` pins the tuning constants — if either side gains a grade or a
 * granular the other did not, that test fails and names the file.
 *
 * WHY IT IS A NARROW HELPER AND NOT A WIDENING OF `isSprayInput`. `dayState.ts`'s
 * `isSprayInput` feeds `logHasCategoryWork` → `computeScheduleGap`, which is about which
 * SCHEDULED work a log satisfies — a different question with different consequences.
 * Touching it to answer this one would move the schedule engine as a side effect.
 *
 * spec: dfes-companion-2026-07-11 (wave-3.4)
 */

import type { InputEvent } from '../../../types';

export type WaterAffinity = 'WaterCarried' | 'Dry' | 'Unknown';

/**
 * The KNOWN water-soluble NPK grades, in canonical hyphen form.
 * Mirrors `ShramSafal.Domain.Dfes.NpkGradeTable.KnownGrades`.
 *
 * Membership means "a recognised WSF grade". WSFs only exist dissolved, which is what
 * makes the founder's "0 52 34" self-classifying with no flag anywhere.
 */
const KNOWN_GRADES: ReadonlySet<string> = new Set([
    '0-52-34',   // MKP (mono-potassium phosphate)
    '19-19-19',  // balanced NPK WSF
    '0-60-20',   // high-P/K WSF
    '13-0-45',   // KNO3 (potassium nitrate)
    '0-0-50',    // SOP/MOP
    '0-0-60',    // SOP/MOP
]);

/**
 * Recognised grape inputs and their agronomic role.
 * Mirrors `ShramSafal.Domain.Dfes.GrapeProductRoles.Entries` — canonical names only, since
 * the client never sees a raw STT string (the server has already normalised it by the time
 * a log is saved).
 *
 * A role containing "paste" is painted onto the cane and carries no water; everything else
 * here (fungicide / insecticide / PGR / foliar) reaches the vine dissolved.
 */
const GRAPE_PRODUCT_ROLES: ReadonlyMap<string, string> = new Map([
    ['dormex', 'dormancy-break paste'],
    ['ethrel', 'defoliation/ripening'],
    ['6-ba', 'berry sizing'],
    ['cppu', 'berry sizing'],
    ['ga3', 'berry elongation'],
    ['bavistin', 'systemic fungicide'],
    ['curzate', 'downy mildew control'],
    ['alphamethrin', 'pyrethroid insecticide'],
    ['mancozeb', 'contact fungicide'],
    ['copper sulfate', 'Bordeaux mixture input'],
    ['lime', 'Bordeaux mixture alkalizer'],
    ['rally gold', 'systemic fungicide (myclobutanil)'],
    ['pdh', 'potassium di-hydrogen adjuvant'],
]);

/**
 * Broadcast / soil granulars and bulk organics — the founder's `fertiliser rule = dry
 * granular`. Mirrors `ProductWaterAffinity.DryGranulars`.
 *
 * Deliberately SHORT and explicitly named: an unrecognised name must fall through to
 * 'Unknown' and keep asking, never be guessed dry. Every entry added here silences a real
 * question, so it is an agronomic decision and not a convenience.
 */
const DRY_GRANULARS: ReadonlySet<string> = new Set([
    'dap', 'urea', 'mop', 'fym', 'ssp',
    'potash', 'mop potash', 'single super phosphate',
    'di-ammonium phosphate', 'farm yard manure',
    'डीएपी', 'युरिया', 'पोटॅश', 'शेणखत',
]);

/** N-P-K in hyphen or colon form. Anchored: a name that merely CONTAINS three numbers
 *  ("0-52-34 (MKP)", "5:30 वाजता") is not a bare grade and must not resolve at step 1. */
const GRADE_SHAPE = /^\s*\d{1,2}[-:]\d{1,2}[-:]\d{1,2}\s*$/;

function canonicalGrade(s: string | undefined | null): string | undefined {
    if (!s || !GRADE_SHAPE.test(s)) return undefined;
    return s.trim().replace(/:/g, '-');
}

/**
 * Resolve one product row. The resolution order is fixed and total — each step runs only
 * when the one above it did not resolve. See the C# docstring for the full reasoning.
 */
export function resolveWaterAffinity(
    npkGrade: string | undefined | null,
    productName: string | undefined | null,
): WaterAffinity {
    // 1. A recognised NPK grade is water-soluble BY DEFINITION.
    const grade = canonicalGrade(npkGrade) ?? canonicalGrade(productName);
    if (grade !== undefined && KNOWN_GRADES.has(grade)) return 'WaterCarried';

    // 2. A recognised grape input: use its agronomic role.
    const role = productName ? GRAPE_PRODUCT_ROLES.get(productName.trim().toLowerCase()) : undefined;
    if (role !== undefined) {
        return role.toLowerCase().includes('paste') ? 'Dry' : 'WaterCarried';
    }

    // 3. A named dry granular.
    if (productName && DRY_GRANULARS.has(productName.trim().toLowerCase())) return 'Dry';

    // 4. Anything else. Doctrine P4 — do not guess.
    return 'Unknown';
}

/**
 * Does this day owe the water/carrier question?
 *
 * Mirrors `DfesLensExtractor.OwesWater`. The day owes CARRIER when ANY product on it is
 * water-carried, OR when at least one product is UNKNOWN. It owes nothing only when EVERY
 * named product is dry.
 *
 * The asymmetry is deliberate: one unrecognised product is enough to keep the question,
 * because retiring it would remove the farmer's only route to fill that bucket on a day we
 * may simply have failed to recognise (doctrine P4). A day that named no product at all
 * also keeps asking — that is the `length === 0` line, and it is what stops this rule
 * reaching "I sprayed." or a pure-irrigation day.
 */
export function inputsOweWater(inputs: readonly InputEvent[]): boolean {
    const affinities: WaterAffinity[] = [];

    for (const input of inputs) {
        const mix = input.mix ?? [];
        if (mix.length > 0) {
            for (const m of mix) affinities.push(resolveWaterAffinity(m.npkGrade, m.productName));
        } else {
            affinities.push(resolveWaterAffinity(undefined, input.productName));
        }
    }

    if (affinities.length === 0) return true;
    return !affinities.every(a => a === 'Dry');
}
