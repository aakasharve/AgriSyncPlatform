// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_FARMER_ID_LENGTH, toStorableFarmerId } from '../farmerId';
import { readActiveUserId, writeActiveUserId } from '../activeUserId';
import {
    getLegacyDatabaseOwner,
    LEGACY_DATABASE_NAME,
    recordVerifiedLegacyDatabaseOwner,
    resolveDatabaseNameForUser,
} from '../userDatabaseName';

const GUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('toStorableFarmerId', () => {
    it('is the identity for every id shape the app produces', () => {
        for (const id of [GUID, 'user-A', 'farmer-a', 'user/bbbb 2222', 'owner-oversight-test-user']) {
            expect(toStorableFarmerId(id)).toBe(id);
        }
    });

    it('fails closed on empty, oversized and non-printable-ASCII input', () => {
        expect(toStorableFarmerId('')).toBeNull();
        expect(toStorableFarmerId('a'.repeat(MAX_FARMER_ID_LENGTH + 1))).toBeNull();
        expect(toStorableFarmerId('far\u0000mer')).toBeNull();
        expect(toStorableFarmerId('किसान')).toBeNull();
    });
});

describe('persisting a farmer id', () => {
    beforeEach(() => localStorage.clear());

    it('writeActiveUserId stores the id unchanged, and refuses an unstorable one', () => {
        writeActiveUserId(GUID);
        expect(readActiveUserId()).toBe(GUID);
        writeActiveUserId('x'.repeat(MAX_FARMER_ID_LENGTH + 1));
        expect(readActiveUserId()).toBe(GUID);
    });

    it('adoption records the arriving farmer as legacy owner, unchanged', () => {
        expect(resolveDatabaseNameForUser(GUID)).toBe(LEGACY_DATABASE_NAME);
        expect(getLegacyDatabaseOwner()).toBe(GUID);
    });

    it('an unstorable id is never adopted as owner and is routed to its own database', () => {
        const name = resolveDatabaseNameForUser('x'.repeat(MAX_FARMER_ID_LENGTH + 1));
        expect(name).not.toBe(LEGACY_DATABASE_NAME);
        expect(getLegacyDatabaseOwner()).toBeNull();
    });

    it('the verified-owner mirror rewrites only with a storable owner', () => {
        expect(recordVerifiedLegacyDatabaseOwner(GUID)).toBe(true);
        expect(recordVerifiedLegacyDatabaseOwner(GUID)).toBe(false);
        expect(recordVerifiedLegacyDatabaseOwner('')).toBe(false);
        expect(getLegacyDatabaseOwner()).toBe(GUID);
    });
});
