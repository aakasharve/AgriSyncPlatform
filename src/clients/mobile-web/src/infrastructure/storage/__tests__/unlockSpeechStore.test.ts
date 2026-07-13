// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * unlockSpeechStore — Task 8 (spec: dfes-companion-2026-07-11). Asserts the
 * once-ever guard: false before marking, true after, per-farm isolation,
 * and a localStorage-unavailable environment degrades to false/no-throw.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { wasUnlockSpoken, markUnlockSpoken } from '../unlockSpeechStore';

describe('unlockSpeechStore', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('is false before markUnlockSpoken has ever been called for a farm', () => {
        expect(wasUnlockSpoken('farm-1')).toBe(false);
    });

    it('becomes true after markUnlockSpoken', () => {
        markUnlockSpoken('farm-1');
        expect(wasUnlockSpoken('farm-1')).toBe(true);
    });

    it('is isolated per farm — marking farm A never marks farm B', () => {
        markUnlockSpoken('farm-a');
        expect(wasUnlockSpoken('farm-a')).toBe(true);
        expect(wasUnlockSpoken('farm-b')).toBe(false);
    });

    it('wasUnlockSpoken returns false (no throw) when localStorage is unavailable', () => {
        const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
        Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });

        expect(() => wasUnlockSpoken('farm-1')).not.toThrow();
        expect(wasUnlockSpoken('farm-1')).toBe(false);

        if (original) Object.defineProperty(window, 'localStorage', original);
    });

    it('markUnlockSpoken swallows errors (no throw) when localStorage is unavailable', () => {
        const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
        Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });

        expect(() => markUnlockSpoken('farm-1')).not.toThrow();

        if (original) Object.defineProperty(window, 'localStorage', original);
    });
});
