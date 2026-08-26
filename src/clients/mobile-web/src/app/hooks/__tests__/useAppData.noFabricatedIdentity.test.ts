/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * `P4` guard — the pre-sync profile must not invent a farmer.
 *
 * WHAT WAS THERE
 * --------------
 * `useAppData` seeded its `farmerProfile` with a whole stranger: name
 * "Shetkari Raja", village "Nashik", and three colleagues — "Suresh (Manager)"
 * and "Agronomist" — carrying phone numbers that belong to somebody. It also
 * stamped the farm at 20.0N 73.8E with `source: 'manual'`, claiming the farmer
 * had set a location he had never seen.
 *
 * None of it was behind a demo guard. The real demo seed IS gated, by
 * `isPurveshDemoOwner` in `purveshDemoEnrichment.ts`, which is what made this
 * one easy to miss. So every farmer opened AgriSync for the first time into
 * another man's identity, and the location fabrication sat AHEAD of his own GPS
 * in the weather fallback chain — a farmer in Sangli was shown Nashik's
 * forecast with nothing on screen to tell him.
 *
 * WHY A SOURCE-LEVEL TEST
 * -----------------------
 * The honest values are empty ones, and "renders nothing" is what a
 * behavioural test of this hook would have to assert through several layers of
 * Dexie, auth, and data-source mocks — machinery that can itself go green while
 * a constant creeps back into the seed. The defect was a literal in a file, so
 * the guard reads that file. It is deliberately narrow: it names the exact
 * fabrications that shipped, so a future edit that reintroduces one fails here
 * with the reason attached rather than reaching a farmer.
 *
 * evidence: docs/LAUNCH-READINESS-AND-AGRISTACK-2026-08-23.md — Decision 2 item 3
 * doctrine: docs/AGRISYNC-DOCTRINE.md — P4 (no fabricated numbers reach a
 *           farmer), P5 (a truthful missing feature beats a fake working one)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'useAppData.ts'),
    'utf8',
);

/**
 * Only the executable body. The comments above the seed quote the old values on
 * purpose — that is the record of what went wrong and why, and it must not be
 * what trips this test.
 */
const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');

describe('useAppData seed — no fabricated identity', () => {
    it.each([
        ['Shetkari Raja', 'a farmer name nobody chose'],
        ['Suresh (Manager)', 'an invented colleague'],
        ['Agronomist', 'an invented colleague'],
        ['9876543210', "a real person's phone number"],
        ['9876543211', "a real person's phone number"],
    ])('does not seed %s (%s)', (literal) => {
        expect(code).not.toContain(literal);
    });

    it("does not seed Nashik's coordinates as the farmer's own location", () => {
        // 20.0N 73.8E, and the old stamp called it `source: 'manual'` — i.e.
        // "the farmer set this". Weather resolves farm centre → profile
        // location → device GPS, so this pre-empted his real position.
        expect(code).not.toMatch(/lat:\s*20(\.0+)?\s*,/);
        expect(code).not.toMatch(/lon:\s*73\.8/);
        expect(code).not.toMatch(/source:\s*'manual'/);
    });

    it('seeds an empty name and village so the UI can honestly show nothing', () => {
        expect(code).toMatch(/name:\s*''/);
        expect(code).toMatch(/village:\s*''/);
    });

    it("keeps exactly one operator — the owner, whose id partitions the farmer's logs", () => {
        // `activeOperatorId: 'owner'` is not cosmetic: `LogFactory` and
        // `log-partition-builders` branch on `activeOperatorId === 'owner'`.
        // The entry stays; the invented people around it do not.
        expect(code).toContain("activeOperatorId: 'owner'");
        expect(code.match(/role:\s*'PRIMARY_OWNER'/g) ?? []).toHaveLength(1);
        expect(code).not.toMatch(/role:\s*'SECONDARY_OWNER'/);
    });
});
