// Rules: this browser's own identity, sent with a sign-in and with every renewal.
//
// The module remembers its id for as long as the page lives, and several rules are about what a
// NEW page does. Every test here therefore opens its own fresh page (see support/freshPage.ts),
// in a browser that has the store the test hands it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStore, installStore } from '../support/browser';
import { isFreshPageCopy, openFreshPage } from '../support/freshPage';
import { DEVICE_KEY } from '../support/session';

/** What every page load of this file hands out: its own copy of the module under test. */
export function loadPage(): Promise<typeof import('@/lib/deviceIdentity')> {
  return import('@/lib/deviceIdentity');
}

/** 8-4-4-4-12 hex: the shape of a random id. */
const RANDOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fresh page load in a browser that has this store. Gives back the page's `deviceIdentity`. */
async function freshPage(store: FakeStore) {
  installStore(store);
  const page = await openFreshPage<{ loadPage: typeof loadPage }>(import.meta.url);
  const { deviceIdentity } = await page.loadPage();
  return () => {
    // More than one page can be open in a test: each looks into its own browser's store.
    installStore(store);
    return deviceIdentity();
  };
}

if (!isFreshPageCopy(import.meta.url)) {
  describe("this browser's identity", () => {
    it('is kept under admin.device.v1', () => {
      assert.equal(DEVICE_KEY, 'admin.device.v1');
    });

    it('says: Control room (browser), web, remember this device, and a random id', async () => {
      const deviceIdentity = await freshPage(new FakeStore());
      const identity = deviceIdentity();

      assert.match(identity.deviceId, RANDOM_ID);
      assert.deepEqual(
        { ...identity, deviceId: '(checked above)' },
        {
          deviceId: '(checked above)',
          deviceName: 'Control room (browser)',
          platform: 'web',
          rememberDevice: true,
        },
      );
    });

    it('gives the same id on every call', async () => {
      const deviceIdentity = await freshPage(new FakeStore());
      const first = deviceIdentity().deviceId;

      assert.equal(deviceIdentity().deviceId, first);
      assert.equal(deviceIdentity().deviceId, first);
    });

    it('keeps the id in the browser store', async () => {
      const store = new FakeStore();
      const deviceIdentity = await freshPage(store);
      const id = deviceIdentity().deviceId;

      assert.equal(store.peek('admin.device.v1'), id);
    });

    it('gives the same id on a fresh page load with the same store', async () => {
      const store = new FakeStore();
      const firstPage = await freshPage(store);
      const idOnFirstPage = firstPage().deviceId;

      const secondPage = await freshPage(store);
      const thirdPage = await freshPage(store);

      assert.equal(secondPage().deviceId, idOnFirstPage);
      assert.equal(thirdPage().deviceId, idOnFirstPage);
    });

    it('uses the id the store already holds, left there by an earlier page load', async () => {
      const leftByAnEarlierPage = '0f8fad5b-d9cb-469f-a165-70867728950e';
      const store = new FakeStore();
      store.put(DEVICE_KEY, leftByAnEarlierPage);
      const deviceIdentity = await freshPage(store);

      assert.equal(deviceIdentity().deviceId, leftByAnEarlierPage);
      assert.equal(store.peek(DEVICE_KEY), leftByAnEarlierPage);
    });

    const notAnId = [
      'not-an-id',
      '0f8fad5b-d9cb-469f-a165-70867728950', // one character short
      '0f8fad5bd9cb469fa16570867728950e', // no dashes
      'zf8fad5b-d9cb-469f-a165-70867728950e', // not hex
      ' 0f8fad5b-d9cb-469f-a165-70867728950e', // a space in front
    ];
    for (const stored of notAnId) {
      it(`replaces a stored value that is not in the shape of a random id: "${stored}"`, async () => {
        const store = new FakeStore();
        store.put(DEVICE_KEY, stored);
        const deviceIdentity = await freshPage(store);
        const id = deviceIdentity().deviceId;

        assert.match(id, RANDOM_ID);
        assert.notEqual(id, stored);
        assert.equal(store.peek(DEVICE_KEY), id, 'the new id takes the place of the old value');
      });
    }

    it('gives two ids for two stores', async () => {
      const oneBrowser = await freshPage(new FakeStore());
      const anotherBrowser = await freshPage(new FakeStore());

      assert.notEqual(oneBrowser().deviceId, anotherBrowser().deviceId);
    });

    const refusals: Array<[what: string, refuse: (store: FakeStore) => void]> = [
      [
        'to be read and to be written',
        (store) => {
          store.refuseReads = true;
          store.refuseWrites = true;
        },
      ],
      [
        'to be read',
        (store) => {
          store.refuseReads = true;
        },
      ],
      [
        'to be written',
        (store) => {
          store.refuseWrites = true;
        },
      ],
    ];
    for (const [what, refuse] of refusals) {
      it(`gives one id for the life of the page, and never throws, when the store refuses ${what}`, async () => {
        const store = new FakeStore();
        refuse(store);
        const deviceIdentity = await freshPage(store);

        let first = '';
        assert.doesNotThrow(() => {
          first = deviceIdentity().deviceId;
        });
        assert.match(first, RANDOM_ID);
        assert.equal(deviceIdentity().deviceId, first);
        assert.equal(deviceIdentity().deviceId, first);
        assert.equal(deviceIdentity().deviceName, 'Control room (browser)');
      });
    }
  });
}
