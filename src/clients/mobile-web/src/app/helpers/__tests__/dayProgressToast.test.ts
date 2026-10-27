/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13, round 3 — I13-V2-m8) — a VOICE auto-save keeps the day's
 * progress it used to show, without a second phone claim (the result screen says "लक्षात ठेवलं" itself, only after
 * the write) and without the word "नोंद".
 */
import { describe, expect, it } from 'vitest';
import { buildDayProgressToast, buildQueuedLogToast } from '../saveToastMessages';

describe('buildDayProgressToast', () => {
    it('Marathi: the day\'s progress, labelled as worked out by the app, no claim, no "नोंद", no English', () => {
        const toast = buildDayProgressToast('mr', 40, 60);
        expect(toast).toEqual({ message: 'आजचा दिवस 40% वरून 60% पूर्ण · आपोआप मोजलं', type: 'success' });
        expect(toast.message).not.toContain('लक्षात ठेवलं');
        expect(toast.message).not.toContain('नोंद');
        expect(toast.message).not.toMatch(/[A-Za-z]/);
    });

    it('English: English only; the typed path keeps its own toast unchanged', () => {
        expect(buildDayProgressToast('en', 40, 60).message).toBe('Day 40% to 60% complete');
        expect(buildQueuedLogToast('mr', 40, 60).message).toContain('40% वरून 60%');
    });
});
