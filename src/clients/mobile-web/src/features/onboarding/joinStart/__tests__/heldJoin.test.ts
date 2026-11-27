// @vitest-environment jsdom
// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V1-A) — what he scanned or typed before the SMS
// code is classified on the phone, held, and handed over ONCE after sign-in.

import { afterEach, describe, expect, it } from 'vitest';
import {
    dropJoinStartChoices,
    holdJoin,
    holdOwnFarmStart,
    peekHeldJoin,
    readScannedJoin,
    readTypedJoin,
    takeHeldJoin,
    takeOwnFarmStart,
} from '../heldJoin';

afterEach(() => window.sessionStorage.clear());

describe('what a typed text is', () => {
    it('the owner\'s 8-digit invitation, typed the way people type it (spaces, a dash, Marathi digits)', () => {
        expect(readTypedJoin('4821-7730')).toEqual({ kind: 'invitation', code: '48217730' });
        expect(readTypedJoin(' ४८२१ ७७३० ')).toEqual({ kind: 'invitation', code: '48217730' });
        expect(readTypedJoin('https://shramsafal.in/i/48217730')).toEqual({ kind: 'invitation', code: '48217730' });
    });

    it('a 6-character farm code, folded the way the server reads it', () => {
        expect(readTypedJoin('abc-123')).toEqual({ kind: 'farmCode', code: 'ABC123' });
        expect(readTypedJoin('K7M2QX')).toEqual({ kind: 'farmCode', code: 'K7M2QX' });
    });

    it('a farm QR link pasted in', () => {
        expect(readTypedJoin('https://shramsafal.app/join?t=tok-1&f=K7M2QX')).toEqual({ kind: 'qr', token: 'tok-1', farmCode: 'K7M2QX' });
    });

    it('anything incomplete is nothing yet (the send stays grey)', () => {
        for (const text of ['', 'AB12', 'ABCDEFG', '1234567', 'hello world']) expect(readTypedJoin(text)).toBeNull();
    });
});

describe('what a scanned QR is', () => {
    it('the farm QR (either link shape) or an invitation QR; anything else is not taken', () => {
        expect(readScannedJoin('https://shramsafal.app/join?t=tok-9&f=FRM002')).toEqual({ kind: 'qr', token: 'tok-9', farmCode: 'FRM002' });
        expect(readScannedJoin('https://app.shramsafal.in/?join=tok-9&farm=FRM002')).toEqual({ kind: 'qr', token: 'tok-9', farmCode: 'FRM002' });
        expect(readScannedJoin('https://shramsafal.in/i/48217730')).toEqual({ kind: 'invitation', code: '48217730' });
        expect(readScannedJoin('SS-7K4M-29QX')).toBeNull();
        expect(readScannedJoin('https://example.com/whatever')).toBeNull();
    });
});

describe('held once, never twice', () => {
    it('a held join is handed over once', () => {
        holdJoin({ kind: 'farmCode', code: 'ABC123' });
        expect(peekHeldJoin()).toEqual({ kind: 'farmCode', code: 'ABC123' });
        expect(takeHeldJoin()).toEqual({ kind: 'farmCode', code: 'ABC123' });
        expect(takeHeldJoin()).toBeNull();
    });

    it('the own-farm wish and a held join exclude each other; "login" drops both', () => {
        holdJoin({ kind: 'invitation', code: '48217730' });
        holdOwnFarmStart();
        expect(peekHeldJoin()).toBeNull();
        expect(takeOwnFarmStart()).toBe(true);
        expect(takeOwnFarmStart()).toBe(false);

        holdOwnFarmStart();
        holdJoin({ kind: 'qr', token: 't', farmCode: 'FRM002' });
        expect(takeOwnFarmStart()).toBe(false);

        holdOwnFarmStart();
        dropJoinStartChoices();
        expect(takeOwnFarmStart()).toBe(false);
        expect(takeHeldJoin()).toBeNull();
    });

    it('a stored value that is not a well-formed join is never handed over', () => {
        window.sessionStorage.setItem('agrisync:held-join', JSON.stringify({ kind: 'farmCode', code: 'BAD' }));
        expect(takeHeldJoin()).toBeNull();
        window.sessionStorage.setItem('agrisync:held-join', '{not json');
        expect(takeHeldJoin()).toBeNull();
    });

    it('holds no phone number and no name', () => {
        holdJoin({ kind: 'qr', token: 'tok-1', farmCode: 'FRM002' });
        const raw = window.sessionStorage.getItem('agrisync:held-join') ?? '';
        expect(raw).not.toMatch(/\d{10}/);
        expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['farmCode', 'kind', 'token']);
    });
});
