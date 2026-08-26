// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.7 review N2 — A TRIPWIRE ON AN UNWRITTEN ASSUMPTION.
 *
 * The crash reconciler attributes a stranded log to a crop cycle by asking
 * which cycle's dates CONTAIN the log's date. That answers "which cycle was
 * open then" using the cycle's dates AS THEY ARE NOW, and it is only sound
 * because a cycle's dates cannot change after the fact.
 *
 * Today they cannot: `CropCycle.cs` has private setters, a `Create` factory and
 * no mutator; there is no update handler; and the sync catalog carries
 * `create_crop_cycle` and nothing else. So the assumption holds — and NOTHING
 * ANYWHERE SAID SO, which is the shape that bites. Someone adds a close-or-edit
 * path in six months, date containment silently starts re-attributing
 * historical logs, and no test fails.
 *
 * This is that test. It is deliberately cheap and deliberately blunt: it fails
 * when a cycle-mutating mutation type appears in the catalog. The catalog is the
 * choke point — a client cannot change a crop cycle without one, and it is
 * generated from `sync-contract/schemas/mutation-types.json`, so the tripwire
 * sits on the file that any such feature must edit first.
 *
 * WHAT IT DOES NOT COVER, stated rather than implied: a cycle edited SERVER-SIDE
 * and arriving through the pull path needs no new client mutation type, so this
 * would not see it. That is a real hole and it is not closable from here; the
 * durable fix is to freeze the attribution at capture time by recording the
 * cycle on the log. If you are reading this because the test went red, go read
 * the `CycleResolution` header in `logSyncMutationService.ts` before deciding
 * what to do.
 */
import { describe, it, expect } from 'vitest';

import { SYNC_MUTATION_TYPES, SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

/** The only crop-cycle mutation the client may have while the above holds. */
const ALLOWED_CROP_CYCLE_MUTATIONS: ReadonlySet<string> = new Set([SyncMutationName.CreateCropCycle]);

describe('§P0.7 N2 — recovery assumes crop cycles are immutable', () => {
    it('the sync catalog still has no way to change an existing crop cycle', () => {
        // §P0.7 review M3 — MATCH ON `cycle`, NOT ON `crop_cycle`.
        //
        // The first version matched `crop_cycle`/`cropcycle` only. The catalog
        // already names things `abandon_schedule` / `adopt_schedule`, so the
        // obvious future additions — `close_cycle`, `cycle.close`, `end_cycle` —
        // would have sailed straight past the tripwire. Widened to any mutation
        // mentioning a cycle at all; a false positive here costs someone reading
        // one comment, a false negative costs silent re-attribution of history.
        const cycleMutations = (SYNC_MUTATION_TYPES as readonly string[])
            .filter(name => /cycle/i.test(name));

        const unexpected = cycleMutations.filter(name => !ALLOWED_CROP_CYCLE_MUTATIONS.has(name));

        expect(
            unexpected,
            'A crop-cycle mutation beyond `create_crop_cycle` has appeared. The stranded-log '
            + 'reconciler resolves a log\'s cycle by date containment against the cycle\'s CURRENT '
            + 'dates, which is only correct while those dates cannot change. Read the '
            + '`CycleResolution` header in logSyncMutationService.ts before widening this list.',
        ).toEqual([]);
    });

    it('the create mutation itself is still there, so the guard is watching something real', () => {
        // Without this, deleting the mutation entirely would make the test above
        // pass by vacuity — a guard that asserts nothing.
        expect(SYNC_MUTATION_TYPES as readonly string[]).toContain(SyncMutationName.CreateCropCycle);
    });
});
