/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — the co-owner's confirming switch speaks ONE language at
 * a time (founder 2026-10-26: "in English only show English and in Marathi it must show Marathi strictly").
 */
import { describe, expect, it } from 'vitest';
import { confirmAccessCopy } from '../confirmAccessCopy';

describe('confirmAccessCopy — one language at a time', () => {
    it('English mode has no Marathi letters; Marathi mode (and any other) has no English letters', () => {
        for (const line of Object.values(confirmAccessCopy('en'))) expect(line).not.toMatch(/[ऀ-ॿ]/);
        for (const lang of ['mr', 'hi', undefined, null]) {
            for (const line of Object.values(confirmAccessCopy(lang))) expect(line).not.toMatch(/[A-Za-z]/);
        }
    });

    it('says the switch is about confirming records, in both languages', () => {
        expect(confirmAccessCopy('mr').off).toBe('नोंदी पक्क्या करण्याची जबाबदारी द्या');
        expect(confirmAccessCopy('en').on).toBe('Responsible for confirming records');
    });
});
