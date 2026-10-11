// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves - offline Labour read-out cache.
import { describe, it, expect, beforeEach } from 'vitest';
import { LABOUR_MOCK, type LabourData } from '../labourMock';
import { toOfflineReadout, saveLabourReadout, loadLabourReadout } from '../data/labourReadout';
import {
    LABOUR_READOUT_MAX_AGE_MS, clearAllLabourReadouts, clearLabourReadoutsExcept,
} from '../../../infrastructure/storage/LabourReadoutCache';
import { writeCachedRoster, readCachedRoster } from '../data/fieldOperatorRosterCache';
import { setAuthSession, clearAuthSession } from '../../../infrastructure/storage/AuthTokenStore';

// Distinctive money sentinels: none of these numbers may survive anywhere.
const SENT = [987654, 765432, 654321, 543210, 432109, 321098, 210987, 109876, 998877, 887766];

function ownerData(): LabourData {
    const d: LabourData = JSON.parse(JSON.stringify(LABOUR_MOCK));
    d.dashboard.wages = SENT[0]; d.dashboard.advances = SENT[1]; d.dashboard.owed = SENT[2];
    d.dashboard.money = { recorded: SENT[3], paid: SENT[4], advance: SENT[5], owed: SENT[6] };
    d.dashboard.insight = `खर्च ${SENT[7]} रुपये`;
    d.home = { rojandariStated: SENT[8], ukteAgreed: SENT[9], onFarmToday: 4, rojandariToday: 111222, ukteToday: 333444 };
    for (const p of Object.values(d.people)) p.balance = { recorded: SENT[3], paid: SENT[4], advance: SENT[5] };
    d.attendance.todaysLabourAssignmentId = 'assign-secret';
    return d;
}

beforeEach(() => { window.localStorage.clear(); clearAuthSession(); });

describe('toOfflineReadout - never keeps money, for any role', () => {
    it('strips every money field of an OWNER read-out', () => {
        const out = JSON.stringify(toOfflineReadout(ownerData()));
        for (const n of [...SENT, 111222, 333444]) expect(out).not.toContain(String(n));
        expect(out).not.toContain('assign-secret');
        expect(out).not.toContain('रुपये');
    });
    it('renders money as null (em-dash), keeps names, register and counts', () => {
        const src = ownerData();
        const out = toOfflineReadout(src);
        expect(out.dashboard.money).toBeNull();
        expect(out.dashboard.wages).toBeNull();
        expect(out.home.rojandariStated).toBeNull();
        expect(out.home.onFarmToday).toBe(4);
        for (const p of Object.values(out.people)) expect(p.balance).toEqual({ recorded: null, paid: null, advance: null });
        expect(Object.values(out.people).map(p => p.name)).toEqual(Object.values(src.people).map(p => p.name));
        expect(out.ledger.rows.length).toBe(src.ledger.rows.length);
        expect(out.review).toEqual([]);
        expect(out.dashboard.logs).toBe(src.dashboard.logs);
    });
    it('also strips a crew / own projection', () => {
        const d = ownerData(); d.view = 'crew';
        expect(JSON.stringify(toOfflineReadout(d))).not.toContain(String(SENT[3]));
    });
});

describe('cache keying, age and erasure', () => {
    it('round-trips for the same user+farm+window and shows when it was fetched', () => {
        saveLabourReadout('u1', 'f1', 'alltime', ownerData());
        const got = loadLabourReadout('u1', 'f1', 'alltime');
        expect(got).not.toBeNull();
        expect(Date.now() - Date.parse(got!.savedAtUtc)).toBeLessThan(5000);
    });
    it('is invisible to another user, another farm or another window', () => {
        saveLabourReadout('u1', 'f1', 'alltime', ownerData());
        expect(loadLabourReadout('u2', 'f1', 'alltime')).toBeNull();
        expect(loadLabourReadout('u1', 'f2', 'alltime')).toBeNull();
        expect(loadLabourReadout('u1', 'f1', 'week')).toBeNull();
    });
    it('is ignored (and deleted) beyond the 7-day cap, honoured just inside it', () => {
        expect(LABOUR_READOUT_MAX_AGE_MS).toBe(7 * 24 * 3600_000);
        saveLabourReadout('u1', 'f1', 'alltime', ownerData());
        const key = Object.keys(window.localStorage).find(k => k.includes('labour_readout'))!;
        const rec = JSON.parse(window.localStorage.getItem(key)!);
        rec.savedAtUtc = new Date(Date.now() - LABOUR_READOUT_MAX_AGE_MS + 60_000).toISOString();
        window.localStorage.setItem(key, JSON.stringify(rec));
        expect(loadLabourReadout('u1', 'f1', 'alltime')).not.toBeNull();
        rec.savedAtUtc = new Date(Date.now() - LABOUR_READOUT_MAX_AGE_MS - 60_000).toISOString();
        window.localStorage.setItem(key, JSON.stringify(rec));
        expect(loadLabourReadout('u1', 'f1', 'alltime')).toBeNull();
        expect(window.localStorage.getItem(key)).toBeNull();
    });
    it('re-strips money even if the stored copy was hand-edited to contain it', () => {
        saveLabourReadout('u1', 'f1', 'alltime', ownerData());
        const key = Object.keys(window.localStorage).find(k => k.includes('labour_readout'))!;
        const rec = JSON.parse(window.localStorage.getItem(key)!);
        rec.payload.dashboard.money = { recorded: SENT[3], paid: 1, advance: 1, owed: 1 };
        window.localStorage.setItem(key, JSON.stringify(rec));
        expect(JSON.stringify(loadLabourReadout('u1', 'f1', 'alltime'))).not.toContain(String(SENT[3]));
    });
    it('a malformed copy is ignored', () => {
        saveLabourReadout('u1', 'f1', 'alltime', ownerData());
        const key = Object.keys(window.localStorage).find(k => k.includes('labour_readout'))!;
        window.localStorage.setItem(key, JSON.stringify({ savedAtUtc: new Date().toISOString(), payload: { nope: 1 } }));
        expect(loadLabourReadout('u1', 'f1', 'alltime')).toBeNull();
    });
    it('clearAll erases every user; clearExcept keeps only that user', () => {
        saveLabourReadout('u1', 'f1', 'alltime', ownerData());
        saveLabourReadout('u2', 'f1', 'alltime', ownerData());
        clearLabourReadoutsExcept('u2');
        expect(loadLabourReadout('u1', 'f1', 'alltime')).toBeNull();
        expect(loadLabourReadout('u2', 'f1', 'alltime')).not.toBeNull();
        clearAllLabourReadouts();
        expect(loadLabourReadout('u2', 'f1', 'alltime')).toBeNull();
    });
    it('every session end (clearAuthSession: logout / rejected refresh / 401) erases it', () => {
        setAuthSession({ userId: 'u1', accessToken: 't', expiresAtUtc: new Date(Date.now() + 60_000).toISOString() });
        saveLabourReadout('u1', 'f1', 'alltime', ownerData());
        clearAuthSession();
        expect(loadLabourReadout('u1', 'f1', 'alltime')).toBeNull();
    });
    it('the cached field-operator roster (keyed by farm, not user) is erased at session end too', () => {
        writeCachedRoster('f1', [{ id: 'op1', displayName: 'रमेश', isActive: true } as never]);
        expect(readCachedRoster('f1')).not.toBeNull();
        clearAuthSession();
        expect(readCachedRoster('f1')).toBeNull();
    });
});
