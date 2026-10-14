// spec: 2026-08-25-prod-cutover-waves
// The consent GET mapper carries the server's start-of-current-grant under its
// exact wire name, and turns anything unusable into null.
import { describe, it, expect } from 'vitest';
import { getConsent, normalizeConsentDto } from '../ConsentResource';
import type { ConsentStateDto } from '../../dtos';

const base: ConsentStateDto = {
    fullHistoryJournal: true,
    crossFarmAggregation: false,
    researchCorpusExport: false,
    version: 1,
    acceptedAtUtc: null,
    revokedAtUtc: null,
};

describe('consent DTO mapping', () => {
    it('passes the wire field fullHistoryJournalGrantedSinceUtc through', () => {
        const dto = normalizeConsentDto({ ...base, fullHistoryJournalGrantedSinceUtc: '2026-10-14T06:01:00.123456Z' });
        expect(dto.fullHistoryJournalGrantedSinceUtc).toBe('2026-10-14T06:01:00.123456Z');
    });

    it.each([undefined, null, '', 'garbage', 12345 as unknown as string])('maps %s to null', bad => {
        expect(normalizeConsentDto({ ...base, fullHistoryJournalGrantedSinceUtc: bad }).fullHistoryJournalGrantedSinceUtc).toBeNull();
    });

    it('an old server body without the field still maps (additive field)', () => {
        const dto = normalizeConsentDto({ ...base });
        expect(dto.fullHistoryJournal).toBe(true);
        expect(dto.fullHistoryJournalGrantedSinceUtc).toBeNull();
    });

    it('getConsent applies the mapping to the HTTP body (server wire shape)', async () => {
        const wire = { ...base, grantedAtUtc: '2026-01-01T00:00:00Z', withdrawnAtUtc: null, fullHistoryJournalGrantedSinceUtc: '2026-10-14T06:01:00Z' };
        const transport = { http: { get: async () => ({ data: wire }) } } as never;
        const dto = await getConsent(transport);
        expect(dto.fullHistoryJournalGrantedSinceUtc).toBe('2026-10-14T06:01:00Z');
    });
});
