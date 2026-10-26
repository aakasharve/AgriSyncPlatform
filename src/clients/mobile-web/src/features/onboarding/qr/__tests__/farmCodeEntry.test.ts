// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the pure rules behind the typed farm-code door.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    FARM_CODE_LENGTH,
    isCompleteFarmCode,
    joinLandingHref,
    looksLikeLink,
    normalizeFarmCode,
    readJoinLink,
    rememberJoinAfterSignIn,
    takeJoinAfterSignIn,
} from '../farmCodeEntry';

describe('normalizeFarmCode', () => {
    it('capitals, no spaces, no dashes', () => {
        expect(normalizeFarmCode(' k7 m-2qx ')).toBe('K7M2QX');
    });

    it('reads look-alike letters as the digits they stand for (the alphabet has no I, L, O)', () => {
        expect(normalizeFarmCode('o1il2z')).toBe('01112Z');
    });

    it('reads digits typed on a Marathi keyboard as 0–9 (as the server does)', () => {
        expect(normalizeFarmCode('k७m२qx')).toBe('K7M2QX');
        expect(normalizeFarmCode('०१२३४५६७८९')).toBe('0123456789');
    });
});

describe('isCompleteFarmCode', () => {
    it('accepts six characters from the server alphabet', () => {
        expect(FARM_CODE_LENGTH).toBe(6);
        expect(isCompleteFarmCode('K7M2QX')).toBe(true);
        expect(isCompleteFarmCode('0123AZ')).toBe(true);
    });

    it('refuses short, long, or letters a farm code never has', () => {
        expect(isCompleteFarmCode('K7M2Q')).toBe(false);
        expect(isCompleteFarmCode('K7M2QXX')).toBe(false);
        expect(isCompleteFarmCode('K7M2QU')).toBe(false); // U is not in the alphabet
        expect(isCompleteFarmCode('K7M2Q#')).toBe(false);
    });
});

describe('join links', () => {
    it('reads both link shapes in use', () => {
        expect(readJoinLink('https://app.shramsafal.in/?join=tok1&farm=ABC123')).toEqual({ token: 'tok1', farm: 'ABC123' });
        expect(readJoinLink('https://shramsafal.app/join?t=tok2&f=XYZ789&r=Mukadam')).toEqual({ token: 'tok2', farm: 'XYZ789' });
    });

    it('a link without both parts, or not a link, is not a join link', () => {
        expect(readJoinLink('https://shramsafal.app/join?t=tok2')).toBeNull();
        expect(readJoinLink('ABC123')).toBeNull();
    });

    it('the landing href never carries a role', () => {
        const href = joinLandingHref({ token: 't/1', farm: 'ABC123' });
        expect(href).toBe('/?join=t%2F1&farm=ABC123');
        expect(href).not.toContain('role');
    });

    it('tells a link from a code', () => {
        expect(looksLikeLink('https://x.y/?q=1')).toBe(true);
        expect(looksLikeLink('K7M2QX')).toBe(false);
    });
});

describe('sign-in handoff', () => {
    beforeEach(() => window.sessionStorage.clear());

    it('is read once and then forgotten', () => {
        expect(takeJoinAfterSignIn()).toBe(false);
        rememberJoinAfterSignIn();
        expect(takeJoinAfterSignIn()).toBe(true);
        expect(takeJoinAfterSignIn()).toBe(false);
    });
});
