// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b)
import { describe, expect, it } from 'vitest';

import { buildManualDraft } from '../logSyncMutationService';
import type { DailyLog } from '../../../../types';

/**
 * The client half of the manual-draft contract.
 *
 * Until task-0b the manual draft never left Dexie: the `create_daily_log` payload
 * carried identity only, so the server had nothing to persist and every manual day
 * scored 0/10. `buildManualDraft` is what puts the farmer's typed day on the wire.
 *
 * These tests exist because the failure mode here is SILENT. If this function ever
 * starts returning undefined for a manual log, the whole fix reverts with no error, no
 * rejected mutation and no failing server test — the farmer simply goes back to being
 * told he recorded nothing. So the "manual log yields a draft" case is pinned
 * explicitly, not just the negative cases.
 */
function makeLog(partial: Partial<DailyLog>): DailyLog {
    return partial as DailyLog;
}

describe('buildManualDraft', () => {
    it('carries a manual log\'s typed buckets so the server has something to persist', () => {
        const draft = buildManualDraft(makeLog({
            labour: [{ id: 'lb-0', type: 'HIRED', count: 5, rate: 350 }],
            irrigation: [{ id: 'irr-0', method: 'drip', source: 'borewell', durationHours: 2.5 }],
        } as Partial<DailyLog>));

        expect(draft).toBeDefined();
        expect(draft?.labour).toHaveLength(1);
        expect(draft?.irrigation).toHaveLength(1);
    });

    it('omits a voice confirm — its facts already ride sourceAiJobId', () => {
        const draft = buildManualDraft(makeLog({
            labour: [{ id: 'lb-0', type: 'HIRED', count: 5 }],
            meta: { provenance: { sourceAiJobId: 'job-1' } },
        } as unknown as Partial<DailyLog>));

        expect(draft).toBeUndefined();
    });

    it('omits a log with nothing in it rather than sending empty buckets', () => {
        expect(buildManualDraft(makeLog({ labour: [], inputs: [] } as Partial<DailyLog>))).toBeUndefined();
        expect(buildManualDraft(makeLog({}))).toBeUndefined();
    });

    it('sends only the buckets the farmer actually filled', () => {
        const draft = buildManualDraft(makeLog({
            labour: [{ id: 'lb-0', type: 'HIRED' }],
            machinery: [],
        } as unknown as Partial<DailyLog>));

        expect(Object.keys(draft ?? {})).toEqual(['labour']);
    });
});
