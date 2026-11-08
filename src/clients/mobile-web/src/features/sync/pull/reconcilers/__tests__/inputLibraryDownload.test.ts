/**
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 4) - the phone's download of the product library.
 *
 * A real Dexie (fake-indexeddb) at the SHIPPED version (26), a stub for the network. Proves: the library is asked for
 * with the stored version in `If-None-Match`; a 304 changes nothing; no network, a refusal, a server error or a body that is
 * not a usable library keeps the old copy; a good 200 is stored and swapped in; and a restart adopts the stored copy.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import referenceCatalog from '../../../../../../../../../sync-contract/reference/inputs/catalog.json';
import { AgriLogDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { CATALOG_VERSION, matchProduct, setStoredLibrary, type CatalogFile } from '../../../../../domain/inputs/inputCatalog';
import {
    INPUT_LIBRARY_PATH,
    INPUT_LIBRARY_POLL_MS,
    INPUT_LIBRARY_ROW_ID,
    adoptStoredInputLibrary,
    resetInputLibraryThrottle,
    runInputLibraryStep,
    syncInputLibrary,
    type InputLibraryFetch,
    type InputLibraryRow,
} from '../inputLibraryDownload';

const served = (version: string): CatalogFile => ({ ...structuredClone(referenceCatalog), version }) as unknown as CatalogFile;

const ok = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

interface Call { path: string; init: RequestInit }

/** A network that answers with each response in turn (a function throws), recording every request. */
function network(...answers: Array<Response | (() => Response) | Error>): { fetch: InputLibraryFetch; calls: Call[] } {
    const calls: Call[] = [];
    let i = 0;
    return {
        calls,
        fetch: async (path, init) => {
            calls.push({ path, init });
            const next = answers[Math.min(i++, answers.length - 1)];
            if (next instanceof Error) throw next;
            return typeof next === 'function' ? next() : next;
        },
    };
}

let db: AgriLogDatabase;
let n = 0;
const NOW = () => '2026-11-08T06:00:00.000Z';

const row = async (): Promise<InputLibraryRow | undefined> => db.table<InputLibraryRow, string>('inputLibrary').get(INPUT_LIBRARY_ROW_ID);

beforeEach(async () => {
    db = new AgriLogDatabase(`inputlib-download-${++n}-${Math.random().toString(36).slice(2)}`);
    await db.open();
    setStoredLibrary(null);
    resetInputLibraryThrottle();
});

afterEach(async () => {
    setStoredLibrary(null);
    db.close();
    await db.delete();
});

describe('the library download (lane IT1c Task 4)', () => {
    it('the shipped Dexie version has the inputLibrary store', () => {
        expect(db.verno).toBe(27); // v26 added the inputLibrary store; lane L8b-2's v27 keeps it
        expect(db.tables.map(t => t.name)).toContain('inputLibrary');
    });

    it('a first download is stored and swapped in, and asks with no version', async () => {
        const net = network(ok(served('inputs-2.1')));

        const outcome = await syncInputLibrary(db, { fetch: net.fetch, now: NOW });

        expect(outcome).toBe('updated');
        expect(net.calls).toHaveLength(1);
        expect(net.calls[0].path).toBe(INPUT_LIBRARY_PATH);
        expect(net.calls[0].init.method).toBe('GET');
        expect((net.calls[0].init.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
        expect((await row())?.version).toBe('inputs-2.1');
        expect((await row())?.updatedAtUtc).toBe(NOW());
        expect(CATALOG_VERSION).toBe('inputs-2.1');
    });

    it('Library_304_ChangesNothing', async () => {
        await syncInputLibrary(db, { fetch: network(ok(served('inputs-2.1'))).fetch, now: () => 'first' });
        const before = await row();
        const net = network(new Response(null, { status: 304 }));

        const outcome = await syncInputLibrary(db, { fetch: net.fetch, now: () => 'second' });

        expect(outcome).toBe('not-modified');
        // It asked with the stored version, quoted: the server's ETag.
        expect((net.calls[0].init.headers as Record<string, string>)['If-None-Match']).toBe('"inputs-2.1"');
        expect(await row()).toEqual(before);
        expect((await row())?.updatedAtUtc).toBe('first');
        expect(CATALOG_VERSION).toBe('inputs-2.1');
        expect(matchProduct('Abacin').state).toBe('found');
    });

    it('Library_OfflineFetchFailure_KeepsOldCopy', async () => {
        await syncInputLibrary(db, { fetch: network(ok(served('inputs-2.1'))).fetch, now: () => 'first' });
        const before = await row();

        for (const answer of [
            new TypeError('Failed to fetch'),
            new Response('boom', { status: 500 }),
            new Response('no', { status: 401 }),
            new Response('gone', { status: 404 }),
        ]) {
            const outcome = await syncInputLibrary(db, { fetch: network(answer).fetch, now: () => 'later' });
            expect(outcome).toBe('unavailable');
            expect(await row()).toEqual(before);
            expect(CATALOG_VERSION).toBe('inputs-2.1');
            expect(matchProduct('Abacin').state).toBe('found');
        }
    });

    it('a body that is not a usable library is rejected and the old copy stays', async () => {
        await syncInputLibrary(db, { fetch: network(ok(served('inputs-2.1'))).fetch, now: () => 'first' });
        const before = await row();
        const twoOfOneId = served('inputs-2.2');
        twoOfOneId.products[1].id = twoOfOneId.products[0].id;

        for (const answer of [ok({ version: '', products: [] }), ok(twoOfOneId), new Response('<html>', { status: 200 }), ok('text')]) {
            expect(await syncInputLibrary(db, { fetch: network(answer).fetch, now: () => 'later' })).toBe('rejected');
            expect(await row()).toEqual(before);
            expect(CATALOG_VERSION).toBe('inputs-2.1');
        }
    });

    it.each([
        ['brands:[null]', (v: CatalogFile) => { (v.products[3].brands as unknown[]).push(null); }],
        ['activeIngredients:[null]', (v: CatalogFile) => { (v.products[3].activeIngredients as unknown[]).push(null); }],
        ['aliases:[5]', (v: CatalogFile) => { (v.products[3].aliases as unknown[]).push(5); }],
        ['sourceRefs:[null]', (v: CatalogFile) => { (v.products[3].sourceRefs as unknown[]).push(null); }],
        ['differingUses with no value', (v: CatalogFile) => {
            (v.products[3] as unknown as { differingUses: unknown[] }).differingUses = [{ field: 'targets', sourcePosition: 1, labelMr: 'a', labelEn: 'b' }];
        }],
    ])('a server copy with %s never throws and leaves the old copy in Dexie and in memory', async (_name, damage) => {
        await syncInputLibrary(db, { fetch: network(ok(served('inputs-2.1'))).fetch, now: () => 'first' });
        const before = await row();
        const bad = served('inputs-2.2');
        damage(bad);

        const outcome = await syncInputLibrary(db, { fetch: network(ok(bad)).fetch, now: () => 'later' });

        expect(outcome).toBe('rejected');
        expect(await row()).toEqual(before);
        expect((await row())?.version).toBe('inputs-2.1');
        expect(CATALOG_VERSION).toBe('inputs-2.1');
        expect(matchProduct('Abacin').state).toBe('found');
        // The next ask still names the good version: the phone is not left on a poisoned one.
        const net = network(new Response(null, { status: 304 }));
        await syncInputLibrary(db, { fetch: net.fetch, now: () => 'again' });
        expect((net.calls[0].init.headers as Record<string, string>)['If-None-Match']).toBe('"inputs-2.1"');
    });

    it('a copy that passes the checks but cannot be taken into use keeps the old copy, in Dexie and in memory', async () => {
        await syncInputLibrary(db, { fetch: network(ok(served('inputs-2.1'))).fetch, now: () => 'first' });
        const before = await row();

        for (const prepare of [() => null, () => { throw new TypeError('cannot read properties of null'); }]) {
            const outcome = await syncInputLibrary(db, { fetch: network(ok(served('inputs-2.2'))).fetch, now: () => 'later', prepare });

            expect(outcome).toBe('kept-old-copy');
            expect(await row()).toEqual(before);
            expect(CATALOG_VERSION).toBe('inputs-2.1');
        }
    });

    it('a failing Dexie write keeps the old copy in memory and does not throw', async () => {
        await syncInputLibrary(db, { fetch: network(ok(served('inputs-2.1'))).fetch, now: () => 'first' });
        db.close(); // the store is no longer writable

        const outcome = await syncInputLibrary(db, { fetch: network(ok(served('inputs-2.2'))).fetch, now: () => 'later' });

        expect(outcome).toBe('unavailable');
        expect(CATALOG_VERSION).toBe('inputs-2.1');
    });

    it('a stored row the phone cannot use names no version to the server, so it is replaced, not kept by a 304', async () => {
        await db.table('inputLibrary').put({ id: INPUT_LIBRARY_ROW_ID, version: 'inputs-2.9', library: { version: 'inputs-2.9', sources: [], products: [{ id: 'p-x', brands: [null] }] }, updatedAtUtc: 'old' });
        expect(await adoptStoredInputLibrary(db)).toBe(false);
        expect(CATALOG_VERSION).toBe('inputs-2');
        const net = network(ok(served('inputs-2.10')));

        expect(await syncInputLibrary(db, { fetch: net.fetch, now: NOW })).toBe('updated');

        expect((net.calls[0].init.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
        expect((await row())?.version).toBe('inputs-2.10');
        expect(CATALOG_VERSION).toBe('inputs-2.10');
    });

    it('the after-a-pull call asks at most once per poll interval; the start call always asks', async () => {
        const net = network(new Response(null, { status: 304 }));
        let clock = 1_000_000;
        const afterPull = { fetch: net.fetch, minIntervalMs: INPUT_LIBRARY_POLL_MS, nowMs: () => clock, now: NOW };

        expect(await runInputLibraryStep(db, { fetch: net.fetch, nowMs: () => clock })).toBe('not-modified'); // app start
        clock += 15_000; // the next pull, 15 seconds later
        expect(await runInputLibraryStep(db, afterPull)).toBe('skipped');
        clock += INPUT_LIBRARY_POLL_MS; // long enough
        expect(await runInputLibraryStep(db, afterPull)).toBe('not-modified');
        expect(net.calls).toHaveLength(2);
        clock += 15_000;
        expect(await runInputLibraryStep(db, afterPull)).toBe('skipped');
        expect(net.calls).toHaveLength(2);
    });

    it('an ask that learned nothing (no network) does not start the interval', async () => {
        const offline = network(new TypeError('Failed to fetch'));
        let clock = 5_000_000;
        const deps = { fetch: offline.fetch, minIntervalMs: INPUT_LIBRARY_POLL_MS, nowMs: () => clock, now: NOW };

        expect(await runInputLibraryStep(db, deps)).toBe('unavailable');
        clock += 15_000;
        expect(await runInputLibraryStep(db, deps)).toBe('unavailable'); // asked again at the next chance
        expect(offline.calls).toHaveLength(2);
    });

    it.each([404, 500, 503])('an ERROR ANSWER (%i) does not free the throttle: the next pull does not ask again', async (status) => {
        const failing = network(new Response('error', { status }));
        let clock = 8_000_000;
        const deps = { fetch: failing.fetch, minIntervalMs: INPUT_LIBRARY_POLL_MS, nowMs: () => clock, now: NOW };

        expect(await runInputLibraryStep(db, deps)).toBe('unavailable'); // the server answered, with an error
        clock += 15_000; // the next pull
        expect(await runInputLibraryStep(db, deps)).toBe('skipped');
        clock += 15_000;
        expect(await runInputLibraryStep(db, deps)).toBe('skipped');
        expect(failing.calls).toHaveLength(1);

        clock += INPUT_LIBRARY_POLL_MS; // the interval has passed: it asks again
        expect(await runInputLibraryStep(db, deps)).toBe('unavailable');
        expect(failing.calls).toHaveLength(2);
    });

    it('a THROWN fetch (no answer at all) frees the throttle, an error answer does not', async () => {
        let clock = 9_000_000;
        const thrown = network(new TypeError('Failed to fetch'));
        const asThrown = { fetch: thrown.fetch, minIntervalMs: INPUT_LIBRARY_POLL_MS, nowMs: () => clock, now: NOW };
        expect(await runInputLibraryStep(db, asThrown)).toBe('unavailable');
        clock += 15_000;
        expect(await runInputLibraryStep(db, asThrown)).toBe('unavailable');
        expect(thrown.calls).toHaveLength(2); // asked at the very next chance

        resetInputLibraryThrottle();
        const answered = network(new Response('error', { status: 500 }));
        const asAnswered = { fetch: answered.fetch, minIntervalMs: INPUT_LIBRARY_POLL_MS, nowMs: () => clock, now: NOW };
        expect(await runInputLibraryStep(db, asAnswered)).toBe('unavailable');
        clock += 15_000;
        expect(await runInputLibraryStep(db, asAnswered)).toBe('skipped');
        expect(answered.calls).toHaveLength(1);
    });

    it('a clock that moved backward is not waited on: the throttle counts as elapsed', async () => {
        const net = network(new Response(null, { status: 304 }));
        let clock = 20_000_000;
        const deps = { fetch: net.fetch, minIntervalMs: INPUT_LIBRARY_POLL_MS, nowMs: () => clock, now: NOW };

        expect(await runInputLibraryStep(db, deps)).toBe('not-modified');
        clock -= 60 * 60 * 1000; // the clock is set back an hour
        expect(await runInputLibraryStep(db, deps)).toBe('not-modified'); // asked, not skipped
        expect(net.calls).toHaveLength(2);
        clock += 15_000; // and from the new time the interval is measured again
        expect(await runInputLibraryStep(db, deps)).toBe('skipped');
        expect(net.calls).toHaveLength(2);
    });

    it('runInputLibraryStep never throws, whatever the network or the database does', async () => {
        db.close();

        await expect(runInputLibraryStep(db, { fetch: network(new Error('boom')).fetch })).resolves.toBe('unavailable');
        await expect(runInputLibraryStep(db, { fetch: () => { throw new Error('sync boom'); } })).resolves.toBe('unavailable');
    });

    it('with no stored copy, a failed download leaves the bundled seed in use', async () => {
        const outcome = await syncInputLibrary(db, { fetch: network(new TypeError('Failed to fetch')).fetch, now: NOW });

        expect(outcome).toBe('unavailable');
        expect(await row()).toBeUndefined();
        expect(CATALOG_VERSION).toBe('inputs-2');
        expect(matchProduct('Abacin').state).toBe('found');
    });

    it('a newer published copy replaces the stored one', async () => {
        await syncInputLibrary(db, { fetch: network(ok(served('inputs-2.1'))).fetch, now: () => 'first' });
        const net = network(ok(served('inputs-2.2')));

        expect(await syncInputLibrary(db, { fetch: net.fetch, now: () => 'second' })).toBe('updated');

        expect((net.calls[0].init.headers as Record<string, string>)['If-None-Match']).toBe('"inputs-2.1"');
        expect((await row())?.version).toBe('inputs-2.2');
        expect(CATALOG_VERSION).toBe('inputs-2.2');
        expect(await db.table('inputLibrary').count()).toBe(1);
    });

    it('a restart adopts the stored copy before any network, and the step then asks the server', async () => {
        await syncInputLibrary(db, { fetch: network(ok(served('inputs-2.3'))).fetch, now: () => 'first' });
        setStoredLibrary(null); // a fresh process: the bundled seed is in use
        expect(CATALOG_VERSION).toBe('inputs-2');

        expect(await adoptStoredInputLibrary(db)).toBe(true);
        expect(CATALOG_VERSION).toBe('inputs-2.3');

        setStoredLibrary(null);
        const net = network(new Response(null, { status: 304 }));
        expect(await runInputLibraryStep(db, { fetch: net.fetch, now: NOW })).toBe('not-modified');
        expect(CATALOG_VERSION).toBe('inputs-2.3'); // adopted from storage even though the network said nothing new
    });

    it('with nothing stored there is nothing to adopt', async () => {
        expect(await adoptStoredInputLibrary(db)).toBe(false);
        expect(CATALOG_VERSION).toBe('inputs-2');
    });
});
