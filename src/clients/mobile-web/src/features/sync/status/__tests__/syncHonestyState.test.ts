/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T1.
 *
 * Locks the three claims the sync chip is allowed to make, and — more
 * importantly — locks the two claims it must NOT make:
 *
 *   1. `ON_SERVER` must be unreachable without a real per-mutation server
 *      acknowledgement. An enqueued-but-unacked row is `ON_PHONE`, full stop
 *      (controller ruling `R5`, doctrine `P4`/`P5`).
 *   2. A row past the auto-retry cap must not read as "we are still working
 *      on it" — the app gave up on it and the farmer has to be told.
 *
 * No Dexie here on purpose: the derivation takes plain row data, so every
 * branch is provable without a database.
 */

import { describe, it, expect } from 'vitest';

import {
    deriveSyncHonestyState,
    MAX_AUTO_RETRY_COUNT,
    SYNC_HONESTY_I18N_KEYS,
    SYNC_HONESTY_OPEN_STATUSES,
    type SyncHonestyState,
    type SyncQueueRowSnapshot,
} from '../syncHonestyState';
import { t } from '../../../../i18n/translations';

function row(
    status: SyncQueueRowSnapshot['status'],
    retryCount = 0,
): SyncQueueRowSnapshot {
    return { status, retryCount };
}

describe('deriveSyncHonestyState — one state per evidence level', () => {
    it('ON_PHONE: a queued row that the server has not answered yet', () => {
        expect(deriveSyncHonestyState([row('PENDING')])).toBe('ON_PHONE');
    });

    it('ON_SERVER: nothing outstanding', () => {
        expect(deriveSyncHonestyState([])).toBe('ON_SERVER');
    });

    it('NEEDS_FIX: a durably rejected row', () => {
        expect(deriveSyncHonestyState([row('REJECTED_USER_REVIEW')])).toBe('NEEDS_FIX');
    });
});

describe('deriveSyncHonestyState — the claims it must refuse to make', () => {
    // The whole point of the task. `db.outbox` used to drive this label and
    // nothing ever drained it, so the chip said "Sending..." forever. Now the
    // absence of an acknowledgement must read as "on the phone", never as sent.
    it('an enqueued-but-unacknowledged row is ON_PHONE, never ON_SERVER', () => {
        const queue: SyncQueueRowSnapshot[] = [
            row('PENDING'),
            row('SENDING'),
            row('FAILED', 1),
        ];

        expect(deriveSyncHonestyState(queue)).toBe('ON_PHONE');
        expect(deriveSyncHonestyState(queue)).not.toBe('ON_SERVER');
    });

    it('an in-flight (SENDING) row is still only ON_PHONE — the wire is not evidence', () => {
        expect(deriveSyncHonestyState([row('SENDING')])).toBe('ON_PHONE');
    });

    it(`a FAILED row at the retry cap (${MAX_AUTO_RETRY_COUNT}) is NEEDS_FIX, not ON_PHONE`, () => {
        expect(deriveSyncHonestyState([row('FAILED', MAX_AUTO_RETRY_COUNT)])).toBe('NEEDS_FIX');
        expect(deriveSyncHonestyState([row('FAILED', MAX_AUTO_RETRY_COUNT + 3)])).toBe('NEEDS_FIX');
    });

    it('a FAILED row below the cap is ON_PHONE — the worker will retry it by itself', () => {
        expect(deriveSyncHonestyState([row('FAILED', MAX_AUTO_RETRY_COUNT - 1)])).toBe('ON_PHONE');
    });

    it('one applied row does not launder an unacknowledged sibling into ON_SERVER', () => {
        // The composite-log case: one save enqueues create_daily_log plus one
        // add_log_task per planned task. Weakest state wins, or the chip
        // claims a record is on the server while part of it is not.
        expect(deriveSyncHonestyState([row('APPLIED'), row('PENDING')])).toBe('ON_PHONE');
    });

    it('NEEDS_FIX outranks every other state regardless of row order', () => {
        expect(deriveSyncHonestyState([row('REJECTED_USER_REVIEW'), row('PENDING')])).toBe('NEEDS_FIX');
        expect(deriveSyncHonestyState([row('PENDING'), row('REJECTED_USER_REVIEW')])).toBe('NEEDS_FIX');
        expect(deriveSyncHonestyState([row('APPLIED'), row('FAILED', MAX_AUTO_RETRY_COUNT)])).toBe('NEEDS_FIX');
    });
});

describe('deriveSyncHonestyState — terminal rows', () => {
    it('a fully acknowledged queue is ON_SERVER', () => {
        expect(deriveSyncHonestyState([row('APPLIED'), row('APPLIED')])).toBe('ON_SERVER');
    });

    it('a row the farmer explicitly discarded does not latch the chip on NEEDS_FIX', () => {
        // REJECTED_DROPPED is an acknowledged loss (the farmer chose it in the
        // conflict screen), not a silent one. Treating it as NEEDS_FIX would
        // re-create the permanently-stuck chip this task exists to remove.
        expect(deriveSyncHonestyState([row('REJECTED_DROPPED')])).toBe('ON_SERVER');
    });
});

describe('the label/badge halves cannot disagree', () => {
    // The old chip could render "Sending... [0]": its label came from
    // db.outbox and its badge from db.mutationQueue. Structurally, an
    // "in flight" label beside a zero count is now impossible because there
    // is no in-flight state at all, and ON_PHONE requires >= 1 open row.
    it('ON_PHONE is unreachable from an empty queue', () => {
        expect(deriveSyncHonestyState([])).not.toBe('ON_PHONE');
    });

    it('every state ON_PHONE can be derived from implies at least one open row', () => {
        const openOnly: SyncQueueRowSnapshot[][] = [
            [row('PENDING')],
            [row('SENDING')],
            [row('FAILED', 0)],
        ];

        for (const queue of openOnly) {
            expect(deriveSyncHonestyState(queue)).toBe('ON_PHONE');
            expect(queue.length).toBeGreaterThan(0);
        }
    });

    it('the statuses read out of Dexie are exactly the ones that can change the claim', () => {
        expect([...SYNC_HONESTY_OPEN_STATUSES].sort()).toEqual(
            ['FAILED', 'PENDING', 'REJECTED_USER_REVIEW', 'SENDING'],
        );
    });
});

describe('every state in the model has a label in both languages', () => {
    const states: SyncHonestyState[] = ['ON_PHONE', 'ON_SERVER', 'NEEDS_FIX'];

    it.each(states)('%s resolves to a real string, not the raw key', (state) => {
        const key = SYNC_HONESTY_I18N_KEYS[state];

        expect(t(key, 'en')).not.toBe(key);
        expect(t(key, 'mr')).not.toBe(key);
    });

    // Plan section G wording, field-testable. If a founder revises the Marathi
    // this test is the place it gets revised — deliberately, not by accident.
    it('renders the approved Marathi', () => {
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr')).toBe('फोनवर सेव्ह ✓');
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_SERVER, 'mr')).toBe('पाठवलं ✓');
        expect(t(SYNC_HONESTY_I18N_KEYS.NEEDS_FIX, 'mr')).toBe('अडकलं — तपासा');
    });

    it('renders the approved English', () => {
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'en')).toBe('Saved on phone');
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_SERVER, 'en')).toBe('Sent');
        expect(t(SYNC_HONESTY_I18N_KEYS.NEEDS_FIX, 'en')).toBe('Stuck — check');
    });

    it('no state claims the server without evidence in its own wording', () => {
        // ON_PHONE must not read as "sent". Cheap guard against a future
        // copy edit quietly promoting the weakest claim.
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr')).not.toContain('पाठवलं');
        expect(t(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'en').toLowerCase()).not.toContain('sent');
    });
});
