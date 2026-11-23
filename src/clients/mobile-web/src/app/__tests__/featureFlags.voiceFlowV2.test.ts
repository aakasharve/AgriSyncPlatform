/**
 * spec: voice-flow-v2-2026-11-23 — the v2 flag is OFF unless the build says VITE_VOICE_FLOW_V2=1: ON in the TEST copy
 * (`.env.fieldtest.example`), OFF in production (`.env.production.example`), and never set by the live release workflow.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS } from '../featureFlags';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');
const valueIn = (file: string): string | undefined => read(file).match(/^VITE_VOICE_FLOW_V2=(.*)$/m)?.[1]?.trim();

describe('FEATURE_FLAGS.voiceFlowV2', () => {
    it('reads VITE_VOICE_FLOW_V2', () => {
        expect(read('src/app/featureFlags.ts')).toMatch(/voiceFlowV2:\s*isEnabled\('VITE_VOICE_FLOW_V2'\)/);
    });
    it('is off in the test run (no .env sets it)', () => {
        expect(FEATURE_FLAGS.voiceFlowV2).toBe(false);
    });
    it('is ON in the TEST copy and OFF in production', () => {
        expect(valueIn('.env.fieldtest.example')).toBe('1');
        expect(valueIn('.env.production.example')).toBe('0');
    });
    it('is not turned on by the live release workflows', () => {
        expect(read('../../../.github/workflows/release.yml')).not.toMatch(/VITE_VOICE_FLOW_V2/);
    });
});
