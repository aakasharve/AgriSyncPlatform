import { describe, it, expect } from 'vitest';
import { buildSettingsExtraIds } from '../settingsItems';

describe('buildSettingsExtraIds', () => {
    it('always includes language, consent, export, erase, ai-drafts in order', () => {
        expect(buildSettingsExtraIds(false)).toEqual(['language', 'consent', 'export', 'erase', 'ai-drafts']);
    });
    it('appends billing only for owners', () => {
        expect(buildSettingsExtraIds(true)).toEqual(['language', 'consent', 'export', 'erase', 'ai-drafts', 'billing']);
    });
});
