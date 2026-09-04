/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T1.
 *
 * Locks the claims the sync chip is allowed to make and, more importantly, the
 * ones it must refuse:
 *
 *   1. `ON_SERVER` must be unreachable without a real per-mutation server
 *      acknowledgement — including the case where the queue is simply EMPTY,
 *      which is what a log dropped before it ever reached a queue looks like
 *      from here (review round 1, F1).
 *   2. A row past the auto-retry cap must not read as "still working on it".
 *   3. Whatever the label says, the badge beside it must agree (F2).
 *   4. A mutation status that would change the claim must be in the Dexie read
 *      filter, or the claim silently strengthens by omission (F4).
 *
 * No Dexie here on purpose: the derivation takes plain data, so every branch is
 * provable without a database.
 */

import { describe, it, expect } from 'vitest';

import {
    deriveSyncHonestyState,
    EMPTY_SYNC_EVIDENCE,
    MAX_AUTO_RETRY_COUNT,
    SYNC_HONESTY_I18N_KEYS,
    SYNC_HONESTY_OPEN_STATUSES,
    type SyncEvidenceSnapshot,
    type SyncHonestyState,
    type SyncQueueRowSnapshot,
} from '../syncHonestyState';
import { needsFarmerAction } from '../stuckMutations';
import type { MutationQueueStatus } from '../../../../infrastructure/storage/DexieDatabase';
import { t } from '../../../../i18n/translations';

function row(status: MutationQueueStatus, retryCount = 0): SyncQueueRowSnapshot {
    return { status, retryCount };
}

/**
 * THE BADGE THE FARMER ACTUALLY SEES — an ORACLE, and deliberately in a test
 * file rather than in production.
 *
 * This replaces the deleted `deriveSyncBadgeCounts`, which lived in the
 * production module, claimed to "mirror `AppHeader.tsx:181-182` exactly", had
 * zero production importers, and had silently stopped mirroring anything when
 * T3 (ruling R12) redefined `failedCount`. A test asserting a production
 * function against another production function in the same module proves only
 * that the module agrees with itself.
 *
 * What the farmer sees is composed in exactly two places, and this reproduces
 * both, transcribed at the time of writing:
 *
 *   `useSyncQueueStatus.ts:97-99`
 *       pendingCount = PENDING + SENDING + stillRetrying
 *       failedCount  = stuck.length            (`partitionOpenFailures`)
 *   `AppHeader.tsx:181-182`
 *       pendingCount = queue.pendingCount + pendingUploads + pendingAiJobs
 *       failedCount  = queue.failedCount  + failedUploads
 *
 * The only part that can drift — which open-failure rows count as "stuck" — is
 * NOT reimplemented here: it calls the production predicate
 * `stuckMutations.needsFarmerAction`. The summation around it is `a + b + c`,
 * copied from the two lines above.
 */
function badgeTheFarmerSees(snapshot: SyncEvidenceSnapshot): { pending: number; failed: number } {
    let queuePending = 0;
    let stuck = 0;

    for (const r of snapshot.rows) {
        if (r.status === 'PENDING' || r.status === 'SENDING') {
            queuePending += 1;
        } else if (needsFarmerAction(r)) {
            stuck += 1;
        } else if (r.status === 'FAILED') {
            // Below the cap the worker is still trying by itself, so
            // `useSyncQueueStatus` counts it as pending, not failed (R12).
            queuePending += 1;
        }
        // REJECTED_DROPPED and APPLIED are terminal — `useSyncQueueStatus`
        // reads neither into either number.
    }

    return {
        pending: queuePending + snapshot.pendingUploads + snapshot.pendingAiJobs,
        failed: stuck + snapshot.failedUploads,
    };
}

/** A snapshot with everything at zero unless the test says otherwise. */
function snap(over: Partial<SyncEvidenceSnapshot> = {}): SyncEvidenceSnapshot {
    return { ...EMPTY_SYNC_EVIDENCE, ...over };
}

/** Nothing outstanding, but the server HAS acknowledged this device before. */
function settled(over: Partial<SyncEvidenceSnapshot> = {}): SyncEvidenceSnapshot {
    return snap({ acknowledgedCount: 3, ...over });
}

describe('deriveSyncHonestyState — one claim per evidence level', () => {
    it('ON_PHONE: a queued row the server has not answered yet', () => {
        expect(deriveSyncHonestyState(snap({ rows: [row('PENDING')] }))).toBe('ON_PHONE');
    });

    it('ON_SERVER: nothing outstanding AND an acknowledgement on record', () => {
        expect(deriveSyncHonestyState(settled())).toBe('ON_SERVER');
    });

    it('NEEDS_FIX: a durably rejected row', () => {
        expect(deriveSyncHonestyState(settled({ rows: [row('REJECTED_USER_REVIEW')] }))).toBe('NEEDS_FIX');
    });

    it('no claim at all: nothing outstanding and nothing ever acknowledged', () => {
        expect(deriveSyncHonestyState(EMPTY_SYNC_EVIDENCE)).toBeNull();
    });
});

describe('ON_SERVER requires positive evidence, not merely an absence of bad news', () => {
    // THE REGRESSION THIS BLOCK EXISTS FOR (review round 1, F1).
    // `resolveSyncTarget` returns null for a plot whose crop cycle has not
    // synced down yet, so the log lands in `skippedLogIds` and NO mutation row
    // is ever written. The queue therefore reads empty — identical input to a
    // fully-acknowledged queue. The first version of this module rendered
    // ON_SERVER there: a receipt for a record no code path will ever send.
    it('an empty queue on a device that never got an acknowledgement makes NO claim', () => {
        const neverSynced = snap({ rows: [], acknowledgedCount: 0 });

        expect(deriveSyncHonestyState(neverSynced)).not.toBe('ON_SERVER');
        expect(deriveSyncHonestyState(neverSynced)).toBeNull();
    });

    it('"nothing outstanding" and "everything acknowledged" are no longer the same answer', () => {
        const nothingKnown = snap({ acknowledgedCount: 0 });
        const everythingAcked = snap({ acknowledgedCount: 1 });

        expect(deriveSyncHonestyState(nothingKnown)).toBeNull();
        expect(deriveSyncHonestyState(everythingAcked)).toBe('ON_SERVER');
        expect(deriveSyncHonestyState(nothingKnown)).not.toBe(deriveSyncHonestyState(everythingAcked));
    });

    it('an enqueued-but-unacknowledged row is ON_PHONE, never ON_SERVER', () => {
        const queue = settled({ rows: [row('PENDING'), row('SENDING'), row('FAILED', 1)] });

        expect(deriveSyncHonestyState(queue)).toBe('ON_PHONE');
        expect(deriveSyncHonestyState(queue)).not.toBe('ON_SERVER');
    });

    it('an in-flight (SENDING) row is still only ON_PHONE — the wire is not evidence', () => {
        expect(deriveSyncHonestyState(settled({ rows: [row('SENDING')] }))).toBe('ON_PHONE');
    });

    it('one applied row does not launder an unacknowledged sibling into ON_SERVER', () => {
        // The composite-log case: one save enqueues create_daily_log plus one
        // add_log_task per planned task. Weakest claim wins, or the chip says a
        // record is on the server while part of it is not.
        expect(deriveSyncHonestyState(settled({ rows: [row('APPLIED'), row('PENDING')] }))).toBe('ON_PHONE');
    });
});

describe('a record that reached NO queue still blocks the receipt (C-1)', () => {
    // THE REGRESSION THIS BLOCK EXISTS FOR (final fix round, finding C-1).
    //
    // `acknowledgedCount > 0` closed the FRESH-INSTALL case and nothing else.
    // `APPLIED` rows are never pruned, so on every device that has ever had one
    // mutation applied that condition holds permanently — and `ON_SERVER` was
    // once again produced by the mere absence of open rows. A farmer who had
    // synced before, saving a log whose plot has no crop cycle yet, read
    // `पाठवलं ✓` in the sticky header directly above a panel badge reading
    // `फोनवर सेव्ह ✓ — cannot be sent`, about the record they had just made.
    it('a fully acknowledged device that just dropped a record does NOT say ON_SERVER', () => {
        const droppedOne = settled({ acknowledgedCount: 42, unqueueableCount: 1 });

        expect(deriveSyncHonestyState(droppedOne)).not.toBe('ON_SERVER');
        expect(deriveSyncHonestyState(droppedOne)).toBe('ON_PHONE');
    });

    it('the fallback is ON_PHONE, because that claim is TRUE and provable', () => {
        // `confirmAndSave` wrote the log to `db.logs` before the enqueue was
        // attempted, so "saved on phone" is exactly what happened — and it is
        // the same words the toast and the panel badge already use for it.
        expect(deriveSyncHonestyState(snap({ unqueueableCount: 1 }))).toBe('ON_PHONE');
    });

    it('it never raises the alarm, because there is nothing to retry (B3)', () => {
        // `मदत कराल का?` asks the farmer to step in and unblock something. A
        // skipped log has no queue row, so no worker will retry it and no
        // drawer can list it — there is nothing for him to unblock. Asking
        // would summon him to an action that does not exist.
        expect(deriveSyncHonestyState(settled({ unqueueableCount: 9 }))).not.toBe('NEEDS_FIX');
    });

    it('but it never outranks a real NEEDS_FIX either — weakest claim, not weakest alarm', () => {
        expect(deriveSyncHonestyState(settled({
            unqueueableCount: 1,
            rows: [row('FAILED', MAX_AUTO_RETRY_COUNT)],
        }))).toBe('NEEDS_FIX');
        expect(deriveSyncHonestyState(settled({
            unqueueableCount: 1,
            failedUploads: 1,
        }))).toBe('NEEDS_FIX');
    });

    it('zero dropped records changes nothing at all', () => {
        // The happy path must be byte-identical: this is the ONLY input on
        // which the chip is allowed to say `पाठवलं ✓`.
        expect(deriveSyncHonestyState(settled({ unqueueableCount: 0 }))).toBe('ON_SERVER');
    });
});

describe('the retry cap', () => {
    it(`a FAILED row at the cap (${MAX_AUTO_RETRY_COUNT}) is NEEDS_FIX, not ON_PHONE`, () => {
        expect(deriveSyncHonestyState(settled({ rows: [row('FAILED', MAX_AUTO_RETRY_COUNT)] }))).toBe('NEEDS_FIX');
        expect(deriveSyncHonestyState(settled({ rows: [row('FAILED', MAX_AUTO_RETRY_COUNT + 3)] }))).toBe('NEEDS_FIX');
    });

    it('a FAILED row below the cap is ON_PHONE — the worker will retry it unaided', () => {
        expect(deriveSyncHonestyState(settled({ rows: [row('FAILED', MAX_AUTO_RETRY_COUNT - 1)] }))).toBe('ON_PHONE');
    });

    it('NEEDS_FIX outranks every other claim regardless of row order', () => {
        expect(deriveSyncHonestyState(settled({ rows: [row('REJECTED_USER_REVIEW'), row('PENDING')] }))).toBe('NEEDS_FIX');
        expect(deriveSyncHonestyState(settled({ rows: [row('PENDING'), row('REJECTED_USER_REVIEW')] }))).toBe('NEEDS_FIX');
        expect(deriveSyncHonestyState(settled({ rows: [row('APPLIED'), row('FAILED', MAX_AUTO_RETRY_COUNT)] }))).toBe('NEEDS_FIX');
    });
});

describe('attachment uploads and AI jobs count toward the claim', () => {
    // Review round 1, F2: the badge already counts these
    // (`AppHeader.tsx:181-182`). A label that ignored them could render
    // पाठवलं ✓ beside a red "2" from two permanently-failed photo uploads.
    it('a permanently failed upload is NEEDS_FIX even with a fully acknowledged queue', () => {
        expect(deriveSyncHonestyState(settled({ failedUploads: 2 }))).toBe('NEEDS_FIX');
    });

    it('an upload still in flight keeps the claim at ON_PHONE', () => {
        expect(deriveSyncHonestyState(settled({ pendingUploads: 1 }))).toBe('ON_PHONE');
    });

    it('a queued AI job keeps the claim at ON_PHONE', () => {
        expect(deriveSyncHonestyState(settled({ pendingAiJobs: 1 }))).toBe('ON_PHONE');
    });

    it('a failed upload outranks a pending one', () => {
        expect(deriveSyncHonestyState(settled({ pendingUploads: 4, failedUploads: 1 }))).toBe('NEEDS_FIX');
    });
});

describe('terminal rows', () => {
    it('a fully acknowledged queue is ON_SERVER', () => {
        expect(deriveSyncHonestyState(snap({ rows: [], acknowledgedCount: 2 }))).toBe('ON_SERVER');
    });

    it('a row the farmer explicitly discarded does not latch the chip on NEEDS_FIX', () => {
        // REJECTED_DROPPED is an acknowledged loss (the farmer chose it in the
        // conflict screen), not a silent one. Treating it as NEEDS_FIX would
        // re-create the permanently-stuck chip this task exists to remove.
        // Upheld twice on review — ruling R10. Do not invert.
        expect(deriveSyncHonestyState(settled({ rows: [row('REJECTED_DROPPED')] }))).toBe('ON_SERVER');
    });
});

describe('the read filter cannot silently strengthen the claim', () => {
    // Independent oracle: every member of the union, written out by hand rather
    // than read back off the module under test. If a seventh status is added,
    // the `satisfies` below stops compiling here AND the Record in the module
    // stops compiling there — both have to be updated deliberately.
    const ALL_MUTATION_STATUSES = [
        'PENDING',
        'SENDING',
        'APPLIED',
        'FAILED',
        'REJECTED_USER_REVIEW',
        'REJECTED_DROPPED',
    ] as const satisfies readonly MutationQueueStatus[];

    type UncoveredStatus = Exclude<MutationQueueStatus, (typeof ALL_MUTATION_STATUSES)[number]>;
    const _everyStatusIsCovered: UncoveredStatus extends never ? true : never = true;
    void _everyStatusIsCovered;

    it.each(ALL_MUTATION_STATUSES)(
        'if a lone %s row changes the claim, that status must be in the read filter',
        (status) => {
            // Baseline is ON_SERVER, so any deviation means this status matters.
            const claim = deriveSyncHonestyState(settled({ rows: [row(status, MAX_AUTO_RETRY_COUNT)] }));

            if (claim !== 'ON_SERVER') {
                expect(SYNC_HONESTY_OPEN_STATUSES).toContain(status);
            }
        },
    );

    it('every status in the read filter actually matters to the claim', () => {
        // The converse — the filter must not fetch rows it will ignore.
        for (const status of SYNC_HONESTY_OPEN_STATUSES) {
            const claim = deriveSyncHonestyState(settled({ rows: [row(status, MAX_AUTO_RETRY_COUNT)] }));
            expect(claim).not.toBe('ON_SERVER');
        }
    });

    it('excludes the terminal statuses, which are never pruned and bear on nothing', () => {
        expect(SYNC_HONESTY_OPEN_STATUSES).not.toContain('APPLIED');
        expect(SYNC_HONESTY_OPEN_STATUSES).not.toContain('REJECTED_DROPPED');
    });
});

describe('the label and the badge beside it cannot contradict each other', () => {
    // Review round 1, F2 + F5: the first version of this block was named for
    // the badge but touched neither count. The second version fixed that but
    // measured itself against `deriveSyncBadgeCounts`, a production function
    // with no production callers that had gone stale. These assert the claim
    // against `badgeTheFarmerSees` — the oracle above, built from the real
    // `needsFarmerAction` plus the two summation lines it is named after.
    const cases: Array<{ name: string; snapshot: SyncEvidenceSnapshot }> = [
        { name: 'empty + never acknowledged', snapshot: EMPTY_SYNC_EVIDENCE },
        { name: 'empty + acknowledged', snapshot: settled() },
        { name: 'one pending mutation', snapshot: settled({ rows: [row('PENDING')] }) },
        { name: 'one sending mutation', snapshot: settled({ rows: [row('SENDING')] }) },
        { name: 'sub-cap failure', snapshot: settled({ rows: [row('FAILED', 1)] }) },
        { name: 'capped failure', snapshot: settled({ rows: [row('FAILED', MAX_AUTO_RETRY_COUNT)] }) },
        { name: 'durable rejection', snapshot: settled({ rows: [row('REJECTED_USER_REVIEW', 1)] }) },
        { name: 'discarded row', snapshot: settled({ rows: [row('REJECTED_DROPPED')] }) },
        { name: 'pending upload', snapshot: settled({ pendingUploads: 2 }) },
        { name: 'failed upload', snapshot: settled({ failedUploads: 2 }) },
        { name: 'pending AI job', snapshot: settled({ pendingAiJobs: 1 }) },
        { name: 'mixed', snapshot: settled({ rows: [row('PENDING'), row('FAILED', 1)], pendingUploads: 1, pendingAiJobs: 2 }) },
    ];

    it.each(cases)('$name — badge agrees with the claim', ({ snapshot }) => {
        const claim = deriveSyncHonestyState(snapshot);
        const badge = badgeTheFarmerSees(snapshot);

        if (claim === 'ON_SERVER' || claim === null) {
            // A settled or unknown state must show NO badge. This is the
            // "पाठवलं ✓ beside a red 2" defect, asserted away.
            expect(badge.pending).toBe(0);
            expect(badge.failed).toBe(0);
        }

        if (claim === 'NEEDS_FIX') {
            // "Can you help?" must be accompanied by a red count — the ask is
            // only fair if the farmer can see how much is waiting on him.
            expect(badge.failed).toBeGreaterThan(0);
        }

        if (claim === 'ON_PHONE' && snapshot.unqueueableCount === 0) {
            // "Saved on phone" must be accompanied by SOME count — there is
            // always at least one thing outstanding for this claim to hold.
            //
            // Guarded on `unqueueableCount` because a record that reached no
            // queue is countable by no badge; that case has its own test below,
            // and every case in the list above has `unqueueableCount: 0`, so
            // this assertion still runs on all twelve of them.
            expect(badge.pending + badge.failed).toBeGreaterThan(0);
        }
    });

    it('a dropped record shows the label with NO badge, and that is the honest rendering', () => {
        // Nothing in any queue can count it — that absence is exactly what let
        // the chip claim `पाठवलं ✓` over it (C-1). The label is the only surface
        // that can carry the news, so a bare `फोनवर सेव्ह ✓` here is not a
        // contradiction; a green receipt would have been.
        const dropped = settled({ unqueueableCount: 1 });

        expect(deriveSyncHonestyState(dropped)).toBe('ON_PHONE');
        expect(badgeTheFarmerSees(dropped)).toEqual({ pending: 0, failed: 0 });
    });

    it('there is no in-flight claim, so "Sending... [0]" has no expressible form', () => {
        const states: Array<string | null> = cases.map(c => deriveSyncHonestyState(c.snapshot));

        expect(states).not.toContain('PENDING');
        expect(states).not.toContain('SENDING');
    });

    it('a failure the worker is still retrying counts as pending, not as a red number (R12)', () => {
        // This is the case the deleted `deriveSyncBadgeCounts` got wrong. It
        // returned { pending: 9, failed: 4 } for this snapshot — counting the
        // sub-cap FAILED row red — while production has counted it amber since
        // T3 redefined `useSyncQueueStatus.failedCount` as "needs the farmer".
        // The old test passed anyway, because it checked that function against
        // its own arithmetic instead of against the app's.
        const snapshot = settled({
            rows: [row('PENDING'), row('SENDING'), row('FAILED', 1), row('REJECTED_USER_REVIEW', 1)],
            pendingUploads: 3,
            failedUploads: 2,
            pendingAiJobs: 4,
        });

        // pending: PENDING + SENDING + the sub-cap FAILED = 3, + 3 uploads + 4 AI
        // failed:  the durable rejection = 1, + 2 permanently-failed uploads
        expect(badgeTheFarmerSees(snapshot)).toEqual({ pending: 10, failed: 3 });
    });

    it('the same row turns red the moment the worker gives up on it', () => {
        // One character of difference from the row above — the retryCount — and
        // it moves from the amber number to the red one. That is what makes the
        // red number mean "you have to do something" rather than "something once
        // went wrong".
        const subCap = settled({ rows: [row('FAILED', MAX_AUTO_RETRY_COUNT - 1)] });
        const capped = settled({ rows: [row('FAILED', MAX_AUTO_RETRY_COUNT)] });

        expect(badgeTheFarmerSees(subCap)).toEqual({ pending: 1, failed: 0 });
        expect(badgeTheFarmerSees(capped)).toEqual({ pending: 0, failed: 1 });
    });
});

describe('every state in the model has a label in both languages', () => {
    const states: SyncHonestyState[] = ['ON_PHONE', 'ON_SERVER', 'NEEDS_FIX'];

    it.each(states)('%s resolves to a real string, not the raw key', (state) => {
        const key = SYNC_HONESTY_I18N_KEYS[state];

        expect(t(key, 'en')).not.toBe(key);
        expect(t(key, 'mr')).not.toBe(key);
    });

    it('the three states map to three DISTINCT keys and three distinct labels', () => {
        // Guards the pairing itself: two states sharing a key would make one of
        // them unsayable, and the chip would confidently show the wrong claim.
        const keys = states.map(s => SYNC_HONESTY_I18N_KEYS[s]);
        expect(new Set(keys).size).toBe(states.length);

        for (const lang of ['en', 'mr'] as const) {
            const labels = keys.map(k => t(k, lang));
            expect(new Set(labels).size).toBe(states.length);
        }
    });

    // Plan section G wording, field-testable. If a founder revises the Marathi
    // this test is where it gets revised — deliberately, not by accident.
    //
    // FOUNDER REVISION 2026-08-14. `ON_PHONE` and `NEEDS_FIX` were reworded;
    // both new forms are SHORTENED FROM HIS OWN SENTENCES rather than invented
    // — `लक्षात ठेवलं` is the tail of his `…व लक्षात ठेवले` (`sync.onPhoneFull`)
    // and `मदत कराल का?` is his phrase verbatim. The chip is a 72px pill beside
    // the farm switcher, measured at ~13-16 Devanagari code points; both land
    // inside it (14 and 12) and both are SHORTER than what they replace (16 and
    // 13), so no surface can newly clip.
    it('renders the approved Marathi', () => {
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr')).toBe('लक्षात ठेवलं ✓');
        // UNCHANGED, deliberately, and the only one of the three that is. It is
        // the approved wording, it is already shipping, and it is the single
        // claim in the model backed by a server acknowledgement — churning it
        // would be churn for its own sake.
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_SERVER, 'mr')).toBe('शेतनोंदीत जमा ✓');
        expect(t(SYNC_HONESTY_I18N_KEYS.NEEDS_FIX, 'mr')).toBe('मदत कराल का?');
    });

    it('renders the approved English', () => {
        // English must MEAN what the Marathi means, not transliterate it.
        // `ON_PHONE` already said "Shram Sathi has it" — the same claim
        // `लक्षात ठेवलं ✓` makes — so it is left alone. `NEEDS_FIX` follows the
        // Marathi from an instruction into a request for help.
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'en')).toBe('Shram Sathi has it');
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_SERVER, 'en')).toBe('In your farm records');
        expect(t(SYNC_HONESTY_I18N_KEYS.NEEDS_FIX, 'en')).toBe('Can you help?');
    });

    it('the chip labels stay inside the 72px pill the header gives them', () => {
        // The ceiling is MEASURED, not guessed: at 412px width the pill is a
        // 72px box with 140.23px of clearance to the farm switcher, and the
        // outgoing `अडकलं — तपासा` filled 71.92px of it at 13 code points. A
        // wording pass is exactly where a 20-point sentence gets dropped into
        // that box, so the budget is asserted rather than remembered.
        //
        // Code points, not `.length`: a JS string counts UTF-16 units, and
        // Devanagari matras are separate code points that render inside the
        // preceding cluster. This over-counts glyphs, which is the safe
        // direction for a width budget.
        for (const state of states) {
            const label = [...t(SYNC_HONESTY_I18N_KEYS[state], 'mr')];
            expect(label.length).toBeLessThanOrEqual(16);
        }
    });

    it('only ON_SERVER makes the durability promise', () => {
        // The whole point of the reframe. "Kept in your farm records" is a
        // claim that the record is SAFE, so it may appear only where a real
        // server acknowledgement backs it. Saying it over a handset-only
        // record is the false reassurance Phase 1 exists to destroy (`B5`).
        //
        // This replaces the old "must not contain पाठवलं / sent" guard. That
        // guard was written against the retired vocabulary and would now pass
        // vacuously — none of the three strings says "sent" any more, so it
        // could no longer catch anything.
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr')).not.toContain('शेतनोंदीत');
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'en').toLowerCase()).not.toContain('farm records');
        expect(t(SYNC_HONESTY_I18N_KEYS.NEEDS_FIX, 'mr')).not.toContain('शेतनोंदीत');
        expect(t(SYNC_HONESTY_I18N_KEYS.NEEDS_FIX, 'en').toLowerCase()).not.toContain('farm records');

        expect(t(SYNC_HONESTY_I18N_KEYS.ON_SERVER, 'mr')).toContain('शेतनोंदीत');
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_SERVER, 'en').toLowerCase()).toContain('farm records');
    });

    it('the full ON_PHONE form claims the phone and never the farm records', () => {
        // Correct copy with NO SURFACE today: it was drafted for the post-save
        // headline, and L5b ruled the short form there instead. Pinned anyway,
        // so the day it does get a surface it is already the right sentence.
        // The founder's own sentence as of 2026-08-14.
        expect(t('sync.onPhoneFull', 'mr')).toBe('श्रम साथीने समजून घेतलं आणि लक्षात ठेवलं');
        expect(t('sync.onPhoneFull', 'en')).toBe('Shram Sathi understood and remembered it');
        expect(t('sync.onPhoneFull', 'mr')).not.toContain('शेतनोंदीत');
        expect(t('sync.onPhoneFull', 'en').toLowerCase()).not.toContain('farm records');
    });

    it('the full ON_SERVER form is the one sentence allowed to name the system', () => {
        // Also surfaceless — 27 code points against a 72px chip — and defined
        // for the same reason as `onPhoneFull`: so the sentence is already
        // right the day something roomier asks for it. Until 2026-08-14 this
        // key did not exist at all, while `mainViewComponents.tsx` referred to
        // it by name.
        expect(t('sync.onServerFull', 'mr')).toBe('श्रम सफलमध्ये साठवून ठेवलं');
        expect(t('sync.onServerFull', 'en')).toBe('Stored in Shram Safal');
    });

    it('श्रम सफल is the system and श्रम साथी is the helper', () => {
        // FOUNDER RULING 2026-08-14, and it REPLACES the test that used to
        // stand here. That one required every `mr` phone claim to start with
        // `मी` — Sathi in the first person. He relaxed it explicitly ("don't
        // force that as a hard rule"), and his own replacement sentence names
        // Sathi in the THIRD person, so the old rule would have rejected the
        // founder's own copy.
        //
        // What survives is the distinction that carries the honesty: naming
        // श्रम सफल is a claim that THE SYSTEM holds the record, so it may
        // appear only where an acknowledgement backs it. On the on-phone
        // claims it would be the precise false promise this phase removed.
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr')).not.toContain('श्रम सफल');
        expect(t('sync.onPhoneFull', 'mr')).not.toContain('श्रम सफल');
        expect(t('sync.onPhoneFull', 'mr')).toContain('श्रम साथी');

        expect(t('sync.onServerFull', 'mr')).toContain('श्रम सफल');
        expect(t('sync.onServerFull', 'mr')).not.toContain('श्रम साथी');

        // Sathi's own conversational line is untouched and still first person,
        // so the voice did not disappear — it stopped being enforced by prefix.
        expect(t('shramSathi.understanding', 'mr').startsWith('मी')).toBe(true);
    });
});
