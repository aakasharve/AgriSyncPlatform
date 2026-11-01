// @vitest-environment jsdom
/**
 * spec: plr-d10 lane PRV (founder D-26) — the holder's lock chip, the honest labels, and W4 where a total leaves a
 * record out (and nowhere else). One language at a time.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AudienceLockChip } from '../AudienceRow';
import { RuleNotCountedNote, totalLeavesOut } from '../RuleNotCountedNote';
import { audienceCopy, audienceLabel } from '../audienceCopy';
import { ruleWithheldCopy } from '../../../i18n/ruleWithheldTranslations';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { ACCESS_SCOPES_META_KEY } from '../../../infrastructure/storage/accessScopeStore';
import type { FarmAccessScopeDto } from '../../../infrastructure/api/accessScopeDtos';

const lng = vi.hoisted(() => ({ v: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: lng.v }) }));

const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const scope = (days: FarmAccessScopeDto['withheldRecordDays']): FarmAccessScopeDto => ({
    farmId: FARM, ownRecordsOnly: false, seeMoney: true, seeWages: true, seeAttendance: true, seeTests: true,
    seeCompliance: true, seeFarmOverview: true, withheldRecordDays: days,
});

beforeEach(async () => {
    lng.v = 'mr';
    await getDatabase().open();
    await Promise.all(getDatabase().tables.map(t => t.clear()));
});
afterEach(() => cleanup());

describe('the lock chip (the holder\'s lists)', () => {
    it('shows "फक्त मी" / "निवडलेले लोक" on a narrowed record and nothing for the team', () => {
        render(<><AudienceLockChip audience="OnlyMe" testId="a" /><AudienceLockChip audience="Selected" testId="b" /><AudienceLockChip audience={undefined} testId="c" /></>);
        expect(screen.getByTestId('a').textContent).toBe('फक्त मी');
        expect(screen.getByTestId('b').textContent).toBe('निवडलेले लोक');
        expect(screen.queryByTestId('c')).toBeNull();
    });

    it('says the maker stays on someone else\'s record, in one language at a time', () => {
        lng.v = 'en';
        render(<AudienceLockChip audience="OnlyMe" madeBySomeoneElse testId="a" />);
        expect(screen.getByTestId('a').textContent).toBe('Only me and the person who recorded it');
        const mr = audienceCopy('mr');
        expect(audienceLabel(mr, 'OnlyMe', true)).toBe('फक्त मी व नोंद करणारा');
        expect(audienceLabel(mr, null, false)).toBe('सर्व टीम');
        for (const line of Object.values(mr)) expect(line).not.toMatch(/[A-Za-z]|AI/);
    });
});

describe('W4 — a total that leaves a record out says so', () => {
    it('answers only for the kind, farm and days the server named', () => {
        const scopes = [scope([{ kind: 'money', date: '2026-10-30' }])];
        expect(totalLeavesOut(scopes, 'money')).toBe(true);
        expect(totalLeavesOut(scopes, 'work')).toBe(false);
        expect(totalLeavesOut(scopes, 'money', ['other-farm'])).toBe(false);
        expect(totalLeavesOut(scopes, 'money', undefined, '2026-10-01', '2026-10-29')).toBe(false);
        expect(totalLeavesOut(scopes, 'money', [FARM], '2026-10-01', '2026-10-31')).toBe(true);
        expect(totalLeavesOut(null, 'money')).toBe(false);
    });

    it('shows the founder\'s W4 words under the total, and nothing when every record is counted', async () => {
        await getDatabase().appMeta.put({ key: ACCESS_SCOPES_META_KEY, value: { receivedAtUtc: 'T', scopes: [scope([{ kind: 'money', date: '2026-10-30' }])] }, updatedAt: 'T' });
        render(<RuleNotCountedNote kind="money" testId="w4" />);
        await waitFor(() => expect(screen.getByTestId('w4').textContent).toBe(ruleWithheldCopy('mr').notCounted));
        expect(ruleWithheldCopy('mr').notCounted).toBe('श्रमसफलच्या नियमानुसार काही नोंदी या हिशोबात धरलेल्या नाहीत.');
        expect(ruleWithheldCopy('en').notCounted).toBe("By ShramSafal's rules, some records are not counted here.");
        cleanup();

        await getDatabase().appMeta.put({ key: ACCESS_SCOPES_META_KEY, value: { receivedAtUtc: 'T', scopes: [scope([])] }, updatedAt: 'T' });
        render(<RuleNotCountedNote kind="money" testId="w4" />);
        await new Promise(r => setTimeout(r, 30));
        expect(screen.queryByTestId('w4')).toBeNull();
    });
});
