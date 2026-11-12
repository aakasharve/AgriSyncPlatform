/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 7; founder D-137 Q10 = 1; v3 README "VARIETY FACTS") - the QUIET variety line:
 * grey, only when the plot's own variety (a phone-only free-text field) differs from the schedule's variety. Never when either side is empty,
 * nor when the plot's "variety" is just the crop's own name (a downloaded plot carries it). Soil, region, climate: no line, the phone knows
 * nothing of a plot's values.
 */
import { describe, expect, it } from 'vitest';
import { plotVarietyOf, varietyMismatch } from '../varietyLine';

describe('the plot\'s own variety', () => {
    it('Is_what_the_plot_carries_trimmed', () => {
        expect(plotVarietyOf({ variety: ' Sharad Seedless ' }, 'Grapes')).toBe('Sharad Seedless');
    });
    it('Is_nothing_when_empty_or_missing', () => {
        expect(plotVarietyOf({ variety: '' }, 'Grapes')).toBeNull();
        expect(plotVarietyOf({}, 'Grapes')).toBeNull();
        expect(plotVarietyOf(undefined, 'Grapes')).toBeNull();
    });
    it('Is_nothing_when_it_is_the_crops_own_name_in_either_language_(a_downloaded_plot_carries_it)', () => {
        expect(plotVarietyOf({ variety: 'Grapes' }, 'Grapes')).toBeNull();
        expect(plotVarietyOf({ variety: 'grapes' }, 'Grapes')).toBeNull();
        expect(plotVarietyOf({ variety: 'द्राक्ष' }, 'Grapes')).toBeNull();
    });
});

describe('varietyMismatch', () => {
    it('Differs: both sides set and not the same', () => {
        expect(varietyMismatch('Thompson Seedless', { variety: 'Sharad Seedless' }, 'Grapes')).toEqual({ schedule: 'Thompson Seedless', plot: 'Sharad Seedless' });
    });
    it('Same_word_in_another_case_is_not_a_mismatch', () => {
        expect(varietyMismatch('Thompson Seedless', { variety: 'thompson seedless' }, 'Grapes')).toBeNull();
    });
    it('The_same_variety_written_in_another_script_is_not_a_mismatch (P008: never a false claim): भगवा vs Bhagwa', () => {
        expect(varietyMismatch('Bhagwa', { variety: 'भगवा' }, 'Pomegranate')).toBeNull();
        expect(varietyMismatch('Thompson Seedless', { variety: 'थॉम्पसन सीडलेस' }, 'Grapes')).toBeNull();
    });
    it('Two_different_names_in_the_same_script_still_show_the_line (P008)', () => {
        expect(varietyMismatch('Bhagwa', { variety: 'Ganesh' }, 'Pomegranate')).toEqual({ schedule: 'Bhagwa', plot: 'Ganesh' });
    });
    it('No_line_when_the_schedule_names_no_variety', () => {
        expect(varietyMismatch(null, { variety: 'Sharad Seedless' }, 'Grapes')).toBeNull();
        expect(varietyMismatch('', { variety: 'Sharad Seedless' }, 'Grapes')).toBeNull();
    });
    it('No_line_when_the_plot_carries_no_variety_or_only_the_crops_name', () => {
        expect(varietyMismatch('Thompson Seedless', { variety: '' }, 'Grapes')).toBeNull();
        expect(varietyMismatch('Thompson Seedless', { variety: 'Grapes' }, 'Grapes')).toBeNull();
        expect(varietyMismatch('Thompson Seedless', undefined, 'Grapes')).toBeNull();
    });
});
