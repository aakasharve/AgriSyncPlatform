/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FOUNDER DECISION 14 (2026-08-16) — the client mirror of the product water rule, and the
 * PARITY GUARD that stops it drifting from the C# it mirrors.
 *
 * The parity block parses the backend source exactly the way `dfesTuning.test.ts` pins the
 * tuning constants. Two copies of an agronomic table is the real risk this change carries:
 * if the server retires a question the client still asks (or the reverse), the farmer sees
 * a number that moves when it syncs. This test is what makes that impossible to ship
 * quietly.
 *
 * spec: dfes-companion-2026-07-11 (wave-3.4)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveWaterAffinity, inputsOweWater } from '../productWaterAffinity';
import type { InputEvent } from '../../../../types';

const input = (partial: Partial<InputEvent>): InputEvent => ({
    id: 'in-1', method: 'Spray', mix: [], ...partial,
});

describe('resolveWaterAffinity — the resolution order', () => {
    // ── step 1: a recognised NPK grade is water-soluble by definition ─────────

    it.each(['0-52-34', '0:52:34', '19-19-19', '13-0-45'])(
        'a known grade (%s) is water-carried', grade => {
            expect(resolveWaterAffinity(grade, undefined)).toBe('WaterCarried');
        });

    it('reads the grade from the product name too — the founder\'s "0 52 34 दिल"', () => {
        // He names the grade AS the product. That must self-classify with no flag
        // anywhere, which is decision 14's whole point.
        expect(resolveWaterAffinity(undefined, '0-52-34')).toBe('WaterCarried');
    });

    it('does not assume an unrecognised grade shape is soluble', () => {
        expect(resolveWaterAffinity('7-7-7', undefined)).toBe('Unknown');
    });

    it('does not read a clock time as a grade', () => {
        expect(resolveWaterAffinity(undefined, '5:30 वाजता')).toBe('Unknown');
    });

    // ── step 2: a recognised grape input uses its agronomic role ─────────────

    it.each(['Bavistin', 'alphamethrin', 'GA3', 'Copper sulfate'])(
        'a sprayed grape input (%s) is water-carried', name => {
            expect(resolveWaterAffinity(undefined, name)).toBe('WaterCarried');
        });

    it('a paste is dry, because it is painted on and not sprayed', () => {
        expect(resolveWaterAffinity(undefined, 'Dormex')).toBe('Dry');
    });

    // ── step 3: the founder's `fertiliser rule = dry granular` ───────────────

    it.each(['DAP', 'dap', 'urea', 'MOP', 'FYM', 'SSP', 'युरिया'])(
        'a named dry granular (%s) is dry', name => {
            expect(resolveWaterAffinity(undefined, name)).toBe('Dry');
        });

    // ── step 4: everything else keeps asking (P4) ────────────────────────────

    it.each([undefined, '', '   ', 'Vardaan Super Gold', '0-52-34 (MKP)'])(
        'anything unrecognised (%s) is Unknown and keeps asking', name => {
            expect(resolveWaterAffinity(undefined, name)).toBe('Unknown');
        });

    it('a known grade outranks a dry-sounding name — the order is fixed', () => {
        expect(resolveWaterAffinity('0-52-34', 'DAP')).toBe('WaterCarried');
    });
});

describe('inputsOweWater — what the DAY owes', () => {
    it('an all-dry day owes nothing', () => {
        expect(inputsOweWater([
            input({ method: 'Soil', mix: [{ id: 'm1', productName: 'DAP', unit: 'kg' }] }),
        ])).toBe(false);
    });

    it('a water-soluble product still owes water despite method Soil', () => {
        expect(inputsOweWater([
            input({ method: 'Soil', mix: [{ id: 'm1', productName: '0-52-34', npkGrade: '0-52-34', unit: 'kg' }] }),
        ])).toBe(true);
    });

    it('one unknown product among dry ones keeps the whole day asking', () => {
        // The asymmetry is deliberate: retiring the question here would remove the
        // farmer's only route to fill the bucket on a day we merely failed to recognise.
        expect(inputsOweWater([
            input({ mix: [{ id: 'm1', productName: 'DAP', unit: 'kg' }] }),
            input({ mix: [{ id: 'm2', productName: 'Vardaan Super Gold', unit: 'kg' }] }),
        ])).toBe(true);
    });

    it('a day that named no product at all keeps today\'s behaviour', () => {
        expect(inputsOweWater([])).toBe(true);
    });

    it('falls back to the input row\'s own productName when the mix is empty', () => {
        expect(inputsOweWater([input({ productName: 'urea', mix: [] })])).toBe(false);
    });
});

// =============================================================================
// PARITY WITH THE BACKEND — the two copies may never drift
// =============================================================================

describe('parity: productWaterAffinity.ts mirrors ShramSafal.Domain.Dfes', () => {
    const domainDir = resolve(__dirname, '../../../../../../../apps/ShramSafal/ShramSafal.Domain/Dfes');

    /** Reads a backend file, or fails loudly naming it — so a MOVED file breaks this
     *  test with a clear cause instead of silently comparing nothing. */
    function read(file: string): string {
        try {
            return readFileSync(resolve(domainDir, file), 'utf8');
        } catch {
            throw new Error(
                `productWaterAffinity.test.ts: could not read ${file} under ${domainDir}. ` +
                `The backend file was moved or renamed — update this path so the parity ` +
                `guard keeps working, and re-check productWaterAffinity.ts against it.`,
            );
        }
    }

    function matchAll(src: string, file: string, pattern: RegExp): string[] {
        const found = [...src.matchAll(pattern)].map(m => m[1]);
        if (found.length === 0) {
            throw new Error(
                `productWaterAffinity.test.ts: ${pattern} matched nothing in ${file}. ` +
                `The backend table was reshaped — update this parser AND the mirror.`,
            );
        }
        return found;
    }

    it('carries exactly the backend NpkGradeTable grades', () => {
        const grades = matchAll(read('NpkGradeTable.cs'), 'NpkGradeTable.cs', /\["([\d-]+)"\]\s*=/g);

        // Every backend grade must resolve WaterCarried on the client...
        for (const g of grades) {
            expect(resolveWaterAffinity(g, undefined), `backend grade ${g}`).toBe('WaterCarried');
        }
        // ...and the client must not have invented any the backend does not know.
        for (const extra of ['0-0-0', '20-20-20', '12-61-0']) {
            expect(grades).not.toContain(extra);
            expect(resolveWaterAffinity(extra, undefined)).toBe('Unknown');
        }
    });

    it('carries exactly the backend GrapeProductRoles canonical names', () => {
        const src = read('GrapeProductRoles.cs');
        const names = matchAll(src, 'GrapeProductRoles.cs', /new GrapeProduct\(\s*"([^"]+)"/g);

        expect(names.length).toBeGreaterThanOrEqual(13);
        for (const name of names) {
            expect(resolveWaterAffinity(undefined, name), `backend product ${name}`)
                .not.toBe('Unknown');
        }
    });

    it('agrees with the backend on which grape roles are pastes', () => {
        const src = read('GrapeProductRoles.cs');
        // Pull (canonicalName, agronomicRole) pairs: the role is the 3rd string literal
        // of each GrapeProduct(...) constructor.
        const pairs = [...src.matchAll(
            /new GrapeProduct\(\s*"([^"]+)",\s*"[^"]+",\s*"([^"]+)"/g,
        )].map(m => ({ name: m[1], role: m[2] }));

        expect(pairs.length).toBeGreaterThanOrEqual(13);
        for (const { name, role } of pairs) {
            const expected = role.toLowerCase().includes('paste') ? 'Dry' : 'WaterCarried';
            expect(resolveWaterAffinity(undefined, name), `${name} (${role})`).toBe(expected);
        }
    });

    it('carries exactly the backend dry-granular list', () => {
        const src = read('ProductWaterAffinity.cs');
        const block = src.match(/DryGranulars\s*=\s*new\(StringComparer\.OrdinalIgnoreCase\)\s*\{([\s\S]*?)\};/);
        if (!block) {
            throw new Error(
                'productWaterAffinity.test.ts: could not find the DryGranulars initialiser in ' +
                'ProductWaterAffinity.cs — the backend list was reshaped; update this parser ' +
                'AND the mirror.',
            );
        }
        const granulars = [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);

        expect(granulars).toContain('DAP');
        for (const g of granulars) {
            expect(resolveWaterAffinity(undefined, g), `backend granular ${g}`).toBe('Dry');
        }
    });
});
