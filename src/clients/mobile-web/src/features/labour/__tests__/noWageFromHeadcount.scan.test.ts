// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I20 / N2, founder D-7, 2026-10-26) — the
 * regression guard. "Remove EVERY default or inferred wage from हजेरी / headcount … add a
 * regression guard." Labour money is only what the farmer stated (`domain/logs/labourMoney.ts`),
 * later only from an explicit agreement; never a headcount multiplied by a rate.
 *
 * The guard is over ALL app source (tests excluded, comments stripped), so a re-entry point
 * cannot come back in a file nobody thought to list:
 *   - no `defaultWage` (the constant ₹400 that was never saved and never stated);
 *   - no shift rate (`defaultRateMale` / `defaultRateFemale` — count × rate was "Total Paid (Auto)");
 *   - no `calculateLabourCost` (the dead count × rate helper);
 *   - no "× ₹" rendered on a labour / analysis / log screen (the "पुरुष: 3 × ₹400" card).
 * The demo data generator (`features/demo/`) builds sample rows for the bare preview and is the
 * one place a sample amount may be built; it never reaches a real farm.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(process.cwd(), 'src');

const stripComments = (source: string): string => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[^\S\r\n]*\/\/.*$/gm, '')
    .replace(/\s\/\/.*$/gm, '');

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === '__tests__' || name === 'node_modules') continue;
            out.push(...sourceFiles(full));
        } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

const rel = (file: string) => relative(SRC, file).split(sep).join('/');
const ALL = sourceFiles(SRC).filter((f) => !rel(f).startsWith('features/demo/'));
const code = new Map(ALL.map((f) => [rel(f), stripComments(readFileSync(f, 'utf8'))]));
const offenders = (pattern: RegExp, files: string[] = [...code.keys()]) =>
    files.filter((f) => pattern.test(code.get(f) ?? ''));

describe('no wage is ever worked out from a headcount (N2, D-7)', () => {
    it('the scan is not vacuous', () => {
        expect(code.size).toBeGreaterThan(300);
        expect(code.has('features/labour/components/LabourHub.tsx')).toBe(true);
        expect(code.has('features/analysis/components/DailyWorkSummaryView.tsx')).toBe(true);
    });

    it('nothing defines or reads a default wage', () => {
        expect(offenders(/\bdefaultWage\b/)).toEqual([]);
    });

    it('no shift carries a rate', () => {
        expect(offenders(/\bdefaultRate(Male|Female)\b/)).toEqual([]);
    });

    it('the count × rate helper is gone', () => {
        expect(offenders(/\bcalculateLabourCost\b/)).toEqual([]);
    });

    it('no labour, analysis or log screen renders "× ₹"', () => {
        const screens = [...code.keys()].filter((f) =>
            /^features\/(labour|analysis|logs|reflect)\//.test(f) && f.endsWith('.tsx'));
        expect(screens.length).toBeGreaterThan(20);
        expect(offenders(/×\s*₹|×\s*\{?\s*(inr|formatCurrency)\(/, screens)).toEqual([]);
    });
});

/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I20 / N8, founder D-6) — ONE मंजूर. The
 * preview-only "हजेरी बरोबर / मजुरी बरोबर" two-button card (`SeparateConfirm`,
 * `confirmMode='separate'`) was deleted so that model cannot resurface: three separate
 * confirmations exist (हजेरी at once · मंजूर of the work · a future money confirmation on the
 * agreement that never releases money), and "मजुरी बरोबर" is a retired word.
 */
describe('one मंजूर, no separate wage confirmation (N8, D-6)', () => {
    it('the two-button confirm card and its switch are gone', () => {
        expect(code.has('features/labour/components/SeparateConfirm.tsx')).toBe(false);
        expect(offenders(/\bSeparateConfirm\b|\bconfirmMode\b/)).toEqual([]);
    });

    it('no screen says "मजुरी बरोबर"', () => {
        expect(offenders(/मजुरी बरोबर/)).toEqual([]);
    });
});
