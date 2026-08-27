/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { tenureLabel, memberTypeLabel, farmCodeLabel } from '../farmLabels';

describe('farmLabels', () => {
    it('gives bilingual tenure labels', () => {
        expect(tenureLabel('owned').mr).toBe('मालकीची');
        expect(tenureLabel('leased').en).toBe('Leased');
    });
    it('gives bilingual member-type labels', () => {
        expect(memberTypeLabel('temporary').mr).toBe('तात्पुरता');
        expect(memberTypeLabel('family').en).toBe('Family');
    });
    it('labels farmCode as the join code it is, never as a 7/12 land record', () => {
        // `generateFarmCode()` picks six characters out of randomBytes(6). It is
        // not derived from any government record, so rendering it beside ७/१२
        // told the farmer something false about his land document.
        expect(farmCodeLabel('GT-4702', 'mr')).toBe('शेती कोड · GT-4702');
        expect(farmCodeLabel('GT-4702', 'en')).toBe('Farm code · GT-4702');
        expect(farmCodeLabel('GT-4702')).not.toContain('७/१२');
        expect(farmCodeLabel(null)).toBeNull();
    });
});
