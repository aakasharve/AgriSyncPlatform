/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the shared words and number shapes of the
 * पैसे व हिशोब pages: ₹ the Indian way, the server's English review reasons said in Marathi (the amount read
 * out of the reason, never invented), every kind of cost named, and dates in Marathi with Latin digits.
 */
import { describe, expect, it } from 'vitest';
import {
    CATEGORY_LABEL, MONEY_CATEGORIES, categoryLabel, entriesCount, entryState, formatDayKey, formatMoneyDate, reviewReasonLabel, rupees,
} from '../moneyLabels';

describe('moneyLabels', () => {
    it('₹ the Indian way, whole rupees', () => {
        expect(rupees(130200)).toBe('₹ 1,30,200');
        expect(rupees(1249.6)).toBe('₹ 1,250');
        expect(rupees(0)).toBe('₹ 0');
    });

    it('every kind of cost has a Marathi name; an unknown one reads इतर', () => {
        expect(MONEY_CATEGORIES.map(c => CATEGORY_LABEL[c])).toEqual(['मजुरी', 'खत-औषध', 'यंत्र', 'वाहतूक', 'दुरुस्ती', 'इंधन', 'वीज', 'इतर']);
        expect(categoryLabel('Input')).toBe('खत-औषध');
        expect(categoryLabel('Seeds')).toBe('इतर');
    });

    it('the server\'s review reasons, in Marathi', () => {
        expect(reviewReasonLabel('High amount: >= 25000 INR')).toBe('₹ 25,000 किंवा जास्त रक्कम');
        expect(reviewReasonLabel('HIGH_AMOUNT')).toBe('मोठी रक्कम');
        expect(reviewReasonLabel('Possible duplicate entry')).toBe('दुहेरी नोंद असू शकते');
        expect(reviewReasonLabel('Something new')).toBe('वेगळी दिसली — एकदा पाहा');
    });

    it('where an entry stands: waiting first, then corrected, approved, recorded', () => {
        expect(entryState({ reviewStatus: 'NeedsReview', trustStatus: 'Adjusted' })).toBe('NeedsReview');
        expect(entryState({ reviewStatus: 'OK', trustStatus: 'Adjusted' })).toBe('Adjusted');
        expect(entryState({ reviewStatus: 'OK', trustStatus: 'Verified' })).toBe('Approved');
        expect(entryState({ reviewStatus: 'OK', trustStatus: 'Unverified' })).toBe('Captured');
    });

    it('dates in Marathi with Latin digits; nothing for a date that cannot be read', () => {
        expect(formatDayKey('2026-10-25')).toBe('रविवार, 25 ऑक्टो');
        expect(formatMoneyDate('2026-09-05')).toBe('5 सप्टें, 2026');
        // An instant is read on the farm's clock: 20:00 UTC on the 24th is the 25th in India.
        expect(formatMoneyDate('2026-10-24T20:00:00Z')).toBe('25 ऑक्टो, 2026');
        expect(formatMoneyDate('not a date')).toBe('');
        expect(formatMoneyDate(undefined)).toBe('');
    });

    it('counts entries in Marathi', () => {
        expect(entriesCount(1)).toBe('1 नोंद');
        expect(entriesCount(4)).toBe('4 नोंदी');
    });
});
