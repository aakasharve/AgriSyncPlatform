// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves
 *
 * After a session is established with distinctive access/refresh token strings,
 * NO localStorage value, NO sessionStorage value and NO IndexedDB value (every
 * object store of every database, keys and values) contains either token.
 *
 * This is the property that actually protects the farmer. `toStorableFarmerId`
 * is only an identity function for short printable ids; the guarantee that no
 * credential reaches storage comes from callers passing the user id alone, and
 * is pinned here by scanning what really got written.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { setAuthSession, clearAuthSession, type AuthSession } from '../AuthTokenStore';
import { activateDatabaseForUser } from '../activateUserDatabase';
import { getDatabase, resetDatabase } from '../DexieDatabase';
import { toStorableFarmerId } from '../farmerId';

const ACCESS = 'ACCESSTOKEN.eyJzZW50aW5lbCI6ImFjY2Vzcy1kaXN0aW5jdGl2ZSJ9.sig-A1b2C3d4';
const REFRESH = 'REFRESHTOKEN-sentinel-9f8e7d6c5b4a-distinctive';
const USER = 'user-credscan-0001';

function openRaw(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dumpDatabase(name: string): Promise<string> {
    const db = await openRaw(name);
    const parts: string[] = [name];
    try {
        for (const store of Array.from(db.objectStoreNames)) {
            const tx = db.transaction(store, 'readonly');
            const os = tx.objectStore(store);
            const keys = await new Promise<IDBValidKey[]>((res, rej) => {
                const r = os.getAllKeys();
                r.onsuccess = () => res(r.result);
                r.onerror = () => rej(r.error);
            });
            const values = await new Promise<unknown[]>((res, rej) => {
                const r = os.getAll();
                r.onsuccess = () => res(r.result);
                r.onerror = () => rej(r.error);
            });
            parts.push(store, JSON.stringify(keys), JSON.stringify(values, (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v)));
        }
    } finally {
        db.close();
    }
    return parts.join('\n');
}

async function everythingStored(): Promise<string> {
    const out: string[] = [];
    for (const store of [window.localStorage, window.sessionStorage]) {
        for (let i = 0; i < store.length; i += 1) {
            const key = store.key(i)!;
            out.push(key, store.getItem(key) ?? '');
        }
    }
    const dbs = await indexedDB.databases();
    for (const info of dbs) {
        if (info.name) out.push(await dumpDatabase(info.name));
    }
    return out.join('\n');
}

describe('no credential is stored anywhere', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        clearAuthSession();
        await resetDatabase().catch(() => undefined);
    });

    it('scans localStorage, sessionStorage and every IndexedDB store after login/refresh-style sessions', async () => {
        // login, then a refresh that rotates the token; the payload also carries a refresh token
        const login = { userId: USER, accessToken: ACCESS, expiresAtUtc: '2099-01-01T00:00:00Z', refreshToken: REFRESH };
        setAuthSession(login as AuthSession);
        activateDatabaseForUser(toStorableFarmerId(USER)!);
        const db = getDatabase();
        await db.appMeta.put({ key: 'probe', value: 'ordinary value', updatedAt: new Date().toISOString() });
        setAuthSession({ ...login, accessToken: `${ACCESS}-rotated` } as AuthSession);

        const dump = await everythingStored();

        // sanity: the scan really sees what was written (a scan that sees nothing proves nothing)
        expect(dump).toContain(USER);
        expect(dump).toContain('ordinary value');
        expect(dump).toContain('agrisync_auth_session_v1');

        expect(dump).not.toContain('ACCESSTOKEN');
        expect(dump).not.toContain('eyJzZW50aW5lbCI6ImFjY2Vzcy1kaXN0aW5jdGl2ZSJ9');
        expect(dump).not.toContain('sig-A1b2C3d4');
        expect(dump).not.toContain('REFRESHTOKEN');
        expect(dump).not.toContain('9f8e7d6c5b4a');
    });
});
