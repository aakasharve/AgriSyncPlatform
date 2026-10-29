import { describe, it, expect } from 'vitest';
import { LogVerificationStatus, type DailyLog } from '../../../domain/types/log.types';
import { resolveLabourAnchor, NO_ANCHOR_TEST_IDS } from '../labourAnchor';

const TODAY = '2026-09-02';

function log(partial: Partial<DailyLog>): DailyLog {
    return {
        id: 'log-1', date: TODAY,
        context: { selection: [] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
        ...partial,
    } as DailyLog;
}
const confirmed = { status: LogVerificationStatus.CONFIRMED, required: false };
const labour12 = [{ id: 'l1', type: 'hired', count: 12 } as unknown as DailyLog['labour'][number]];

describe('resolveLabourAnchor — the mic opens on a captured headcount (founder D-46)', () => {
    // D-46 #5 (2026-10-27): "Pending approval must not prevent the हजेरी mic from opening merely
    // because the headcount has not been confirmed. It may use the latest captured headcount as
    // provisional context." A voice log saved at once is Draft ("खात्री बाकी") until the owner
    // confirms it, so the mic opens on its count — marked PROVISIONAL, never shown as confirmed.
    it('a Draft log carrying a parsed 12 opens the mic on 12, PROVISIONAL', () => {
        const h = [log({ labour: labour12, verification: { status: LogVerificationStatus.DRAFT, required: true } })];
        expect(resolveLabourAnchor(h, TODAY)).toEqual({ state: 'anchored', headcount: 12, logId: 'log-1', provisional: true });
    });
    it('a legacy PENDING log is provisional too', () => {
        const h = [log({ labour: labour12, verification: { status: LogVerificationStatus.PENDING, required: true } })];
        expect(resolveLabourAnchor(h, TODAY)).toEqual({ state: 'anchored', headcount: 12, logId: 'log-1', provisional: true });
    });
    it('a confirmed count beside a Draft one: both counted, the whole figure provisional (never shown as confirmed)', () => {
        const h = [
            log({ id: 'a', labour: labour12, verification: confirmed }),
            log({ id: 'b', labour: [{ id: 'l2', type: 'hired', count: 4 } as unknown as DailyLog['labour'][number]], verification: { status: LogVerificationStatus.DRAFT, required: true } }),
        ];
        expect(resolveLabourAnchor(h, TODAY)).toEqual({ state: 'anchored', headcount: 16, logId: 'a', provisional: true });
    });
    it('the same log after confirmation IS the anchor, headcount carried forward', () => {
        const h = [log({ labour: labour12, verification: confirmed })];
        expect(resolveLabourAnchor(h, TODAY)).toEqual({ state: 'anchored', headcount: 12, logId: 'log-1' });
    });
    it('a confirmed log whose labour never stated a count is NOT an anchor (unknown is not zero)', () => {
        const h = [log({ labour: [{ id: 'l1', type: 'hired' } as unknown as DailyLog['labour'][number]], verification: confirmed })];
        expect(resolveLabourAnchor(h, TODAY).state).toBe('no-anchor');
    });
    it('a log with no verification record is a captured count nobody accepted: provisional, never confirmed', () => {
        expect(resolveLabourAnchor([log({ labour: labour12 })], TODAY))
            .toEqual({ state: 'anchored', headcount: 12, logId: 'log-1', provisional: true });
    });
    it("yesterday's confirmed log does not anchor today", () => {
        const h = [log({ date: '2026-09-01', labour: labour12, verification: confirmed })];
        expect(resolveLabourAnchor(h, TODAY).state).toBe('no-anchor');
    });
    it('a deleted log does not anchor', () => {
        const h = [log({ labour: labour12, verification: confirmed, deletion: { deletedAtISO: 't', deletedByOperatorId: 'o', reason: 'r' } })];
        expect(resolveLabourAnchor(h, TODAY).state).toBe('no-anchor');
    });
    it('two confirmed engagements sum their STATED counts only', () => {
        const h = [
            log({ id: 'a', labour: labour12, verification: confirmed }),
            log({ id: 'b', labour: [{ id: 'l2', type: 'hired', count: 4 } as unknown as DailyLog['labour'][number], { id: 'l3', type: 'hired' } as unknown as DailyLog['labour'][number]], verification: confirmed }),
        ];
        expect(resolveLabourAnchor(h, TODAY)).toEqual({ state: 'anchored', headcount: 16, logId: 'a' });
    });
    it('exports stable test ids for the hub gate assertions', () => {
        expect(NO_ANCHOR_TEST_IDS.reason).toBe('labour-no-anchor-reason');
    });
});
