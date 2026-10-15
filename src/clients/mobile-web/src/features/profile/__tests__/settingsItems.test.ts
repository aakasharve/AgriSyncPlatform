import { describe, it, expect } from 'vitest';
import { buildSettingsExtraIds } from '../settingsItems';

describe('buildSettingsExtraIds', () => {
    it('always includes language, voice-diary, consent, export, erase, ai-drafts in order', () => {
        expect(buildSettingsExtraIds(false)).toEqual(['language', 'voice-diary', 'consent', 'export', 'erase', 'ai-drafts']);
    });
    it('appends billing only for owners', () => {
        expect(buildSettingsExtraIds(true)).toEqual(['language', 'voice-diary', 'consent', 'export', 'erase', 'ai-drafts', 'billing']);
    });
    it('keeps the Settings -> Voice Diary door open for every role (not owner-gated)', () => {
        expect(buildSettingsExtraIds(false)).toContain('voice-diary');
    });
});
