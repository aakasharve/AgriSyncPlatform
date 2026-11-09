/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 Task 2; founder D-29) - the phone's half of the due-cue pin.
 *
 * A reminder's due date comes from a CLEAR cue only; the server resolves the same cue the same way (`DueHintResolver`). One shared
 * fixture (`sync-contract/tests/fixtures/planned-work-due-cues.json`, produced by this resolver) pins both sides: the C# half is
 * `DueHintResolverTests`. An unclear cue is undated, never "today".
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveDueDate } from '../dueDateResolver';

interface Row { hint: string | null; today?: string; expected: string | null }
const fixture = JSON.parse(readFileSync(
    resolve(__dirname, '../../../../../../../sync-contract/tests/fixtures/planned-work-due-cues.json'), 'utf8')) as { today: string; cases: Row[]; extra: Row[] };

describe('the due-cue rule the server shares', () => {
    it.each([...fixture.cases, ...fixture.extra].map((r, i) => [i, r] as const))('row %i resolves as the fixture says', (_i, row) => {
        expect(resolveDueDate(row.hint ?? undefined, row.today ?? fixture.today)).toBe(row.expected);
    });

    it.each(['नंतर', 'लवकर', 'या आठवड्यात', 'कधीतरी', '', undefined])('an unclear cue (%s) is undated, never today', hint => {
        expect(resolveDueDate(hint, '2026-11-08')).toBeNull();
    });

    it('"उद्या" is the day after the day given', () => {
        expect(resolveDueDate('उद्या', '2026-11-08')).toBe('2026-11-09');
    });
});
