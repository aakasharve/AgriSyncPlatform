/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words) — founder 28 Nov: NO live words for the pilot. The phone sends
 * no piece of his sound for live words unless the build switch VITE_LIVE_WORDS_ENABLED is on. It is OFF when unset, and no env
 * example or release workflow turns it on.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLiveWordsEnabled } from '../featureFlags';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

describe('the live-words switch (VITE_LIVE_WORDS_ENABLED)', () => {
    // The same rule every runtime switch here uses ('1' / 'true' / 'yes' / 'on'; anything else, or absent, is off).
    it('reads VITE_LIVE_WORDS_ENABLED through the one isEnabled rule', () => {
        expect(read('src/app/featureFlags.ts')).toMatch(/isLiveWordsEnabled = \(\): boolean =>\s*isEnabled\('VITE_LIVE_WORDS_ENABLED'\)/);
    });

    it('is OFF when unset (nothing sets it in the test run)', () => {
        expect(isLiveWordsEnabled()).toBe(false);
    });

    it('no env example and no release workflow turns it on', () => {
        for (const file of ['.env.fieldtest.example', '.env.production.example', '../../../.github/workflows/release.yml']) {
            expect(read(file), file).not.toMatch(/VITE_LIVE_WORDS_ENABLED\s*[:=]\s*['"]?(1|true|yes|on)\b/i);
        }
    });

    it('the recorder and the request both read it (two locks: no session starts, and the request itself refuses)', () => {
        expect(read('src/features/voice/components/AudioRecorderStreaming.tsx')).toMatch(/const liveWordsOn = isLiveWordsEnabled\(\) &&/);
        expect(read('src/features/voice/liveWords/liveWordsClient.ts')).toMatch(/if \(!isLiveWordsEnabled\(\)\) return \{ kind: 'off' \};/);
    });
});
