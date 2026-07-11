/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { tenureLabel, memberTypeLabel, sevenTwelveLabel } from '../farmLabels';

describe('farmLabels', () => {
    it('gives bilingual tenure labels', () => {
        expect(tenureLabel('owned').mr).toBe('मालकीची');
        expect(tenureLabel('leased').en).toBe('Leased');
    });
    it('gives bilingual member-type labels', () => {
        expect(memberTypeLabel('temporary').mr).toBe('तात्पुरता');
        expect(memberTypeLabel('family').en).toBe('Family');
    });
    it('formats a 7/12 label from farmCode, or null when missing', () => {
        expect(sevenTwelveLabel('GT-4702')).toBe('७/१२ · GT-4702');
        expect(sevenTwelveLabel(null)).toBeNull();
    });
});
