/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b; founder D-136, D-137 Q10 = 1) - "यासाठी बनवलं": crop shown, days derived,
 * the variety from the app's own `varietyCatalog` (minus "Other"), soil / region / climate short optional pick lists whose codes and Marathi
 * labels are DATA in `sync-contract/schemas/schedule-made-for.json`. Tags only: the phone offers a list, the server checks it.
 */
import { describe, expect, it } from 'vitest';
import lists from '../../../../../../../../sync-contract/schemas/schedule-made-for.json';
import { madeForOptions, tagLabel, varietiesFor } from '../madeFor';

describe('the pick lists', () => {
    it('Soil_region_and_climate_come_from_the_contract_file_codes_and_Marathi_labels', () => {
        expect(madeForOptions('soilType', 'mr')).toEqual(lists.soilType.map(code => ({ code, label: (lists.labelsMr.soilType as Record<string, string>)[code] })));
        expect(madeForOptions('region', 'mr').map(o => o.label)).toEqual(['महाराष्ट्र', 'नाशिक', 'सोलापूर', 'पुणे', 'सांगली', 'सातारा']);
        expect(madeForOptions('climate', 'mr').map(o => o.label)).toEqual(['कोरडं', 'दमट', 'थंड', 'उष्ण', 'जास्त पावसाचं']);
    });
    it('The_codes_sent_are_the_files_codes_(the_server_checks_the_same_file)', () => {
        expect(madeForOptions('climate', 'mr').map(o => o.code)).toEqual(['dry', 'humid', 'cold', 'hot', 'heavy_rain']);
    });
    it('English_mode_shows_the_English_labels', () => {
        expect(madeForOptions('soilType', 'en').map(o => o.label)).toEqual(['Black', 'Red', 'Medium', 'Murum', 'Sandy']);
    });
    it('Each_list_is_short_(6_or_fewer)', () => {
        for (const k of ['soilType', 'region', 'climate'] as const) expect(madeForOptions(k, 'mr').length).toBeLessThanOrEqual(6);
    });
    it('A_code_gets_its_label_and_an_unknown_code_is_shown_as_it_is_never_dropped', () => {
        expect(tagLabel('soilType', 'black', 'mr')).toBe('काळी');
        expect(tagLabel('soilType', 'mystery', 'mr')).toBe('mystery');
    });
});

describe('the variety list is the app\'s own, minus "Other"', () => {
    it('Grapes_have_the_six_grape_varieties_and_no_Other', () => {
        expect(varietiesFor('Grapes')).toEqual(['Super Sonaka', 'Sharad Seedless', 'Thompson Seedless', 'Crimson Seedless', 'Flame Seedless', 'Manik Chaman']);
    });
    it('The_crop_is_read_by_the_crop_rule_so_a_Marathi_name_finds_its_list', () => {
        expect(varietiesFor('द्राक्ष')).toEqual(varietiesFor('Grapes'));
        expect(varietiesFor('Pomegranate')).toEqual(['Bhagwa', 'Ganesh', 'Mridula', 'Arakta']);
    });
    it('Any_other_crop_has_the_fallback_Local_and_Hybrid', () => {
        expect(varietiesFor('Sugarcane')).toEqual(['Local', 'Hybrid']);
    });
    it('Every_variety_offered_is_one_the_contract_accepts', () => {
        const accepted = new Set([...Object.values(lists.variety).flat()]);
        for (const crop of ['Grapes', 'Pomegranate', 'Tomato', 'Onion', 'Sugarcane']) {
            for (const v of varietiesFor(crop)) expect(accepted.has(v)).toBe(true);
        }
    });
});
