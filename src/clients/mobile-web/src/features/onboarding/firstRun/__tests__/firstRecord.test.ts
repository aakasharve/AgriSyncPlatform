/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1. The pure facts behind the first-record card (1a)
 * and the first record's setup-hub offer (1b).
 */
import { describe, expect, it } from 'vitest';
import {
    FIRST_RECORD_CARD_FALLBACK, FIRST_RECORD_CARD_KEY, firstRecordOfferKey, firstRecordVerdict, mayOfferFirstRecord,
} from '../firstRecord';

const rec = (id: string, farmId?: string) => ({ id, meta: farmId ? { farmId } : {} });

describe('the first-record card key (1a)', () => {
    it('has its own once-only key, and no row reads "seen" (an installed phone never sees it, P11)', () => {
        expect(FIRST_RECORD_CARD_KEY).toBe('shramsafal_first_record_card_v1_seen');
        expect(FIRST_RECORD_CARD_FALLBACK).toBe(true);
    });

    it('is offered to the farm owner and a co-owner only', () => {
        expect(mayOfferFirstRecord('PrimaryOwner')).toBe(true);
        expect(mayOfferFirstRecord('SecondaryOwner')).toBe(true);
        for (const role of ['Worker', 'Mukadam', 'Agronomist', '', null, undefined]) expect(mayOfferFirstRecord(role), String(role)).toBe(false);
    });
});

describe('is this recording the farm\'s FIRST record on this phone? (1b)', () => {
    it('a per-farm mark', () => {
        expect(firstRecordOfferKey('farm-1')).toBe('shramsafal_first_record_offer_v1:farm-1');
        expect(firstRecordOfferKey('farm-2')).not.toBe(firstRecordOfferKey('farm-1'));
    });

    it('first: the phone holds only this recording\'s records for the farm (one per plot counts as one recording)', () => {
        expect(firstRecordVerdict(['a'], [rec('a', 'f1')], 'f1')).toBe('first');
        expect(firstRecordVerdict(['a', 'b'], [rec('a', 'f1'), rec('b', 'f1')], 'f1')).toBe('first');
        expect(firstRecordVerdict(['a'], [rec('x', 'f2'), rec('a', 'f1')], 'f1')).toBe('first');
    });

    it('not first: any other record of this farm, or one with no farm on it (fails closed)', () => {
        expect(firstRecordVerdict(['a'], [rec('x', 'f1'), rec('a', 'f1')], 'f1')).toBe('notFirst');
        expect(firstRecordVerdict(['a'], [rec('x'), rec('a', 'f1')], 'f1')).toBe('notFirst');
    });

    it('not decided while the recording is not on the phone\'s list yet, or with no farm', () => {
        expect(firstRecordVerdict(['a'], [], 'f1')).toBe('unknown');
        expect(firstRecordVerdict(['a'], [rec('x', 'f2')], 'f1')).toBe('unknown');
        expect(firstRecordVerdict(['a'], [rec('a', 'f1')], null)).toBe('unknown');
        expect(firstRecordVerdict([], [rec('a', 'f1')], 'f1')).toBe('unknown');
    });
});
