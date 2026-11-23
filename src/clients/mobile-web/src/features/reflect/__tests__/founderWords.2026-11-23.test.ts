/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-founder-answers-2026-11-23 — the four Marathi words the founder changed on his final approval page (MR21, MR23,
 * MR44, MR48). Every other approved word stays as it is. The English twins follow the new meaning (PROPOSED English).
 */
import { describe, expect, it } from 'vitest';
import { RESULT_STR, RESULT_STR_EN } from '../../logs/components/voiceResult/resultStrings';
import { HEALTH_MR } from '../../attention/components/AttentionCard';
import { reflectCopy } from '../reflectCopy';

describe("the founder's four words (23 Nov 2026)", () => {
    it('MR21 — the line under a confirmed recording', () => {
        expect(RESULT_STR.keptSafe).toBe('तुमचे शब्द समजून घेतले आहेत');
        expect(RESULT_STR_EN.keptSafe).toBe('Your words were understood');
    });

    it('MR23 — a part he said that the server could not verify', () => {
        expect(RESULT_STR.unsurePart).toBe('स्पष्ट समजू शकले नाही');
        expect(RESULT_STR_EN.unsurePart).toBe('Could not understand clearly');
        // the overview reuses the same words
        expect(reflectCopy('mr').unsure).toBe('स्पष्ट समजू शकले नाही');
    });

    it("MR44 — the plot's state line, and its neighbours in the same style so the card reads as one", () => {
        expect(HEALTH_MR.Excellent).toBe('पिकाची स्थिती चांगली आहे');
        expect(HEALTH_MR.Good).toBe('पिकाची स्थिती ठीक आहे');
        expect(HEALTH_MR.NeedsAttention).toBe('पिकाच्या स्थितीकडे लक्ष द्या');
        expect(HEALTH_MR.Critical).toBe('पिकाची स्थिती गंभीर आहे');
        for (const line of Object.values(HEALTH_MR)) expect(line).not.toContain('तब्येत');
    });

    it('MR48 — the whole-farm card line', () => {
        expect(reflectCopy('mr').farmCardLine).toBe('असे काम जे कोणत्याही एका प्लॉटशी निगडित नाही तर पूर्ण शेताशी निगडित आहे');
        expect(reflectCopy('en').farmCardLine).toBe('Work not tied to any one plot, but to the whole farm');
    });
});
