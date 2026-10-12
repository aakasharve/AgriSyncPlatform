import { describe, expect, it } from 'vitest';
import { translations } from '../translations';

describe('Marathi correction wording (founder 2026-10-12)', () => {
    it('transcript label does not claim the farmer said it (authorship)', () => {
        expect(translations.mr.voice.transcriptHeardLabel).toBe('ऐकलेलं:');
    });

    it('wizard partner label is the co-owner role word', () => {
        expect(translations.mr.profile.partner).toBe('सहमालक');
    });
});
