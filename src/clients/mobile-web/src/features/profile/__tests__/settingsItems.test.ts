import { describe, it, expect } from 'vitest';
import { buildSettingsExtraIds } from '../settingsItems';

describe('buildSettingsExtraIds', () => {
    it('always includes language, consent, export, erase in order', () => {
        expect(buildSettingsExtraIds(false)).toEqual(['language', 'consent', 'export', 'erase']);
    });
    it('appends billing only for owners', () => {
        expect(buildSettingsExtraIds(true)).toEqual(['language', 'consent', 'export', 'erase', 'billing']);
    });
});
