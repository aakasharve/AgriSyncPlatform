/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T v4; P9 thin client) - the तुलना page draws the server's answer and imports NO
 * comparison engine of the phone's own. The old engine files stay in the tree for the clean-up lane; this guard walks every import the page
 * reaches INSIDE features/compare and fails if one of them is an old engine / old card file, and checks the mic uses the live batch route only.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const DIR = resolve(__dirname, '..');
const OLD = ['plotComparisonService', 'compareRows', 'compareWeek', 'compareText', 'comparePageHelpers', 'ComparePlotCard', 'CompareReplica', 'CompareChecklist', 'CompareDetails'];

const importsOf = (source: string): string[] =>
    Array.from(source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)).map(m => m[1]);

const resolveFile = (from: string, spec: string): string | null => {
    const base = resolve(dirname(from), spec);
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) if (existsSync(base + ext)) return base + ext;
    return null;
};

function reachable(entry: string): { files: string[]; specs: string[] } {
    const seen = new Set<string>();
    const specs: string[] = [];
    const walk = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        for (const spec of importsOf(readFileSync(file, 'utf8'))) {
            specs.push(spec);
            if (!spec.startsWith('.')) continue;
            const next = resolveFile(file, spec);
            if (next && next.startsWith(DIR) && !next.includes(`${join(DIR, '__tests__')}`)) walk(next);
        }
    };
    walk(entry);
    return { files: [...seen].map(f => f.slice(DIR.length + 1).replace(/\\/g, '/')), specs };
}

describe('the तुलना page is a thin client', () => {
    const { files, specs } = reachable(join(DIR, 'ComparePage.tsx'));

    it('walks the page\'s own files (so the guard is not looking at nothing)', () => {
        expect(files).toEqual(expect.arrayContaining(['ComparePage.tsx', 'CompareView.tsx', 'CompareSheets.tsx', 'OwnWorkSheet.tsx', 'compareFacts.ts', 'data/compareDtos.ts']));
    });

    it('imports no comparison engine and no old card of the phone\'s own', () => {
        const hit = files.filter(f => OLD.some(o => f.replace(/\.tsx?$/, '').endsWith(o)));
        expect(hit).toEqual([]);
        const named = specs.filter(s => OLD.some(o => s.endsWith(`/${o}`)));
        expect(named).toEqual([]);
    });

    it('the mic uses the live batch route (planVoice) and not the streaming transcribe route', () => {
        const sheet = readFileSync(join(DIR, 'OwnWorkSheet.tsx'), 'utf8');
        expect(sheet).toContain('understandPlanSpeech');
        expect(sheet).not.toMatch(/transcribe-stream/);
        const all = files.map(f => readFileSync(join(DIR, f), 'utf8')).join('\n');
        expect(all).not.toMatch(/transcribe-stream/);
    });

    it('reads the phone\'s logs nowhere (the server counts)', () => {
        const page = readFileSync(join(DIR, 'ComparePage.tsx'), 'utf8');
        expect(page).not.toMatch(/\blogs\b\s*[,=)]/);
        expect(page).toMatch(/useFarmCompare/);
    });
});
