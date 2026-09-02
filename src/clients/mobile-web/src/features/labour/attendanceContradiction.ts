/**
 * Labour V2 R1 Task 3.3 — the deterministic per-person day-fact comparison.
 *
 * The server twin lives in RecordAttendanceMarkHandler and is authoritative;
 * this copy exists so the question is answered AT CAPTURE (state D) instead
 * of surfacing days later on the sync path. Same rule as the server's तपासा
 * idiom (GetLabourDataHandler.cs:602-612): collect, Distinct, report only
 * when MORE than one fact survives. It is a comparison of two things the
 * farmer already said — the AI is never the producer (the dead
 * LABOUR_SOURCE_CHECK channel stays dead).
 *
 * shiftId here is the config-derived string ('full' | 'half' | 'night'),
 * exactly what DetailSheet.tsx and mapLabourEngagements.ts write — normalised
 * to lower case the way LabourAssignmentFactory.MapLabourShift does server-side.
 */
import type { LabourEvent } from '../../domain/types/log.labour.types';

export type DayShift = 'full' | 'half' | 'night';

export interface DayContradiction {
    name: string;
    facts: Array<{ shift: DayShift; sourceEventId: string }>;
}

const KNOWN: ReadonlySet<string> = new Set(['full', 'half', 'night']);

export function findDayContradictions(events: readonly LabourEvent[]): DayContradiction[] {
    const byName = new Map<string, Array<{ shift: DayShift; sourceEventId: string }>>();
    for (const event of events) {
        const raw = event.shiftId?.toLowerCase();
        if (!raw || !KNOWN.has(raw)) continue;   // no claim → no question
        // Carried 3.2-review minor: workerNames may repeat a name inside one
        // engagement; a fact is listed once per engagement, so a duplicate can
        // neither pad the fact list nor mask anything. Exact-string only —
        // identity merging lives at resolution (rule 10), never here.
        // B002 (3.3 review, carried to 3.5): trimmed before keying, so
        // 'गणेश ' and 'गणेश' spoken across two engagements are ONE person's
        // two facts — an untrimmed key would file them apart and mask the
        // very contradiction this module exists to surface. Exact-string
        // beyond the trim; identity merging stays at resolution (rule 10).
        for (const name of new Set((event.workerNames ?? []).map((n) => n.trim()).filter((n) => n.length > 0))) {
            const list = byName.get(name) ?? [];
            list.push({ shift: raw as DayShift, sourceEventId: event.id });
            byName.set(name, list);
        }
    }
    const out: DayContradiction[] = [];
    for (const [name, facts] of byName) {
        const distinct = new Set(facts.map(f => f.shift));
        if (distinct.size > 1) out.push({ name, facts });
    }
    return out;
}
