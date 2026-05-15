/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DATA_PRINCIPLE_SPINE sub-phase 01.6 — LogProvenance type-shape lock.
 *
 * Locks the frontend `LogProvenance` contract widened by 01.6:
 *   - `source` accepts `'manual' | 'ai' | 'pre_spine'` (was `'manual' | 'ai'`).
 *   - Five new optional fields land: `modelVersion`, `promptContentHash`,
 *     `appVersion`, `sourceAiJobId`, `rawInputRef`.
 *   - Pre-existing fields (`model`, `providerUsed`, `fallbackUsed`,
 *     `promptVersion`, `rawTranscript`, `validation`, etc.) remain
 *     assignable on the same literal.
 *
 * Vitest does not enforce TypeScript at runtime, but this file is included
 * in the project's `tsc --noEmit` CI gate (vitest.config `src/(...)/(...).test.ts`
 * + tsconfig coverage). A compile-time regression on the type shape
 * therefore fails CI as a test failure — which is the intent.
 */

import { describe, it, expect } from 'vitest';
import type { LogProvenance } from '../LogProvenance';

describe('LogProvenance (DATA_PRINCIPLE_SPINE 01.6 — type contract)', () => {
    it('accepts source="pre_spine" with all five new optional fields populated', () => {
        // promptContentHash + appVersion are omitted here — the v16 backfill
        // writes them as JSON `null` on disk, but the type declares them as
        // `string | undefined`. The Dexie upgrade test asserts the on-disk
        // null shape; this test stays inside the type contract.
        const provenance: LogProvenance = {
            source: 'pre_spine',
            modelVersion: 'unknown',
            promptVersion: 'unknown',
            sourceAiJobId: undefined,
            rawInputRef: null,
            timestamp: '2026-05-15T00:00:00.000Z',
        };

        expect(provenance.source).toBe('pre_spine');
        expect(provenance.modelVersion).toBe('unknown');
        expect(provenance.promptVersion).toBe('unknown');
        expect(provenance.rawInputRef).toBeNull();
        expect(provenance.timestamp).toBe('2026-05-15T00:00:00.000Z');
    });

    it('accepts source="ai" with all five new fields stamped from a fresh parse envelope', () => {
        const provenance: LogProvenance = {
            source: 'ai',
            model: 'gemini-2.5-flash',
            modelVersion: 'gemini-2.5-flash',
            providerUsed: 'gemini',
            fallbackUsed: false,
            promptVersion: 'v2026-05-01',
            promptContentHash: 'a'.repeat(64),
            appVersion: '0.9.0',
            sourceAiJobId: '11111111-2222-3333-4444-555555555555',
            rawInputRef: null,
            rawTranscript: 'half-hour drip on plot 3',
            confidenceScore: 0.91,
            processingTimeMs: 842,
            timestamp: '2026-05-15T08:15:00.000Z',
            validation: {
                stage: 'infrastructure_parser',
                outcome: 'pass',
            },
        };

        // Spine-honest aliasing: modelVersion mirrors the legacy `model`
        // field for back-compat. New readers should prefer modelVersion.
        expect(provenance.modelVersion).toBe(provenance.model);
        expect(provenance.sourceAiJobId).toBe('11111111-2222-3333-4444-555555555555');
        expect(provenance.promptContentHash).toHaveLength(64);
        expect(provenance.appVersion).toBe('0.9.0');
        // rawInputRef is `null` in Phase 01 (storage handle lands in Phase 02).
        expect(provenance.rawInputRef).toBeNull();
    });

    it('accepts source="manual" without any of the new fields (back-compat path)', () => {
        const provenance: LogProvenance = {
            source: 'manual',
            timestamp: '2026-05-15T08:30:00.000Z',
        };

        expect(provenance.source).toBe('manual');
        // The five new fields stay optional/undefined on manual entries.
        expect(provenance.modelVersion).toBeUndefined();
        expect(provenance.promptContentHash).toBeUndefined();
        expect(provenance.appVersion).toBeUndefined();
        expect(provenance.sourceAiJobId).toBeUndefined();
        expect(provenance.rawInputRef).toBeUndefined();
    });

    it('rawInputRef is explicitly nullable (string | null | undefined)', () => {
        const withNull: LogProvenance = {
            source: 'ai',
            rawInputRef: null,
            timestamp: '2026-05-15T08:45:00.000Z',
        };
        const withString: LogProvenance = {
            source: 'ai',
            rawInputRef: 'blob://raw-input/abc123',
            timestamp: '2026-05-15T08:45:00.000Z',
        };
        const omitted: LogProvenance = {
            source: 'ai',
            timestamp: '2026-05-15T08:45:00.000Z',
        };

        expect(withNull.rawInputRef).toBeNull();
        expect(withString.rawInputRef).toBe('blob://raw-input/abc123');
        expect(omitted.rawInputRef).toBeUndefined();
    });
});
