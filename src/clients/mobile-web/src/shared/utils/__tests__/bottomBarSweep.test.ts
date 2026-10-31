/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 — founder rule FOOT-1 (2026-10-31): nothing may sit behind the bottom bar, ANYWHERE. A sweep of every
 * screen's source, so a new sheet, toast or footer cannot slip back under the bar:
 *
 *   1. every `fixed` layer that reaches the screen's bottom edge (`inset-0` / `bottom-0` / `inset-y-0`) is one the
 *      bar's overlay rule (`findOverlayOverBar`) recognises — while it is open the bar steps away;
 *   2. a `fixed` layer that floats at some height above the bottom (a toast, the "+" button) sits at the bar's room,
 *      `BOTTOM_BAR_CLEARANCE` — never at its own `bottom-8` / `bottom-24` / "6rem" (those sat under the bar or its raised
 *      centre button: the हजेरी "लक्षात ठेवलं" toast, the setup hub's error note, the app toast);
 *   3. no `sticky … bottom-*` footer: inside the app's scroll area it would stick to the screen's edge, under the bar;
 *   4. the app's ONE scroll area ends with the bar's room, so every page's last line can scroll clear of it.
 *
 * Static: it reads the source, not a rendered page (the rendered rule is `bottomBar.test.ts` and
 * `BottomNavigation.overlay.test.tsx`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'src');

interface Source { rel: string; text: string }

/** Code only: a comment that quotes an old class list ("This was `fixed inset-x-0`") is not a layer on screen. */
const withoutComments = (text: string): string => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/\s.*$/gm, '');
function sources(): Source[] {
    const out: Source[] = [];
    const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) { if (!['__tests__', 'node_modules'].includes(e.name)) walk(join(dir, e.name)); continue; }
            if (!e.name.endsWith('.tsx') || /\.test\.tsx$/.test(e.name)) continue;
            const file = join(dir, e.name);
            out.push({ rel: relative(SRC, file).replace(/\\/g, '/'), text: withoutComments(readFileSync(file, 'utf-8')) });
        }
    };
    walk(SRC);
    return out;
}

/** Every string / template literal in the file whose class tokens include `token`. */
function classStrings(text: string, token: string): string[] {
    const found: string[] = [];
    const LITERAL = /'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g;
    for (const m of text.matchAll(LITERAL)) {
        const body = m[1] ?? m[2] ?? m[3] ?? '';
        if (body.split(/\s+/).includes(token)) found.push(body);
    }
    return found;
}

const tokens = (classes: string): string[] => classes.split(/\s+/).filter(Boolean);
const REACHES_BOTTOM = new Set(['inset-0', 'bottom-0', 'inset-y-0']);
const reachesBottom = (classes: string): boolean => tokens(classes).some(t => REACHES_BOTTOM.has(t));
const bottomOffset = (classes: string): string | undefined => tokens(classes).find(t => /^bottom-/.test(t) && t !== 'bottom-0');

const ALL = sources();

describe('FOOT-1 sweep — every fixed layer in the app', () => {
    it('finds the overlays the bar steps away for (a sanity floor: the sweep reads the real screens)', () => {
        const overlays = ALL.flatMap(s => classStrings(s.text, 'fixed').filter(reachesBottom).map(() => s.rel));
        expect(new Set(overlays).size).toBeGreaterThan(40);
        // the founder's screenshot, and a sheet of each kind the brief names
        for (const rel of [
            'features/profile/components/AddPlotWizard.tsx', 'features/onboarding/components/FirstFarmWizard.tsx',
            'features/scheduler/components/SchedulePickerModal.tsx', 'features/labour/components/ReviewSheet.tsx',
            'features/labour/components/HajeriCellDetail.tsx', 'features/finance/components/MoneyLensDrawer.tsx',
            'features/logs/components/correction/CorrectionScreen.tsx', 'core/speak/SpeakScreen.tsx',
            'features/logs/components/voiceResult/ClipGlance.tsx', 'features/tests/components/TestSheetFrame.tsx',
        ]) expect(overlays).toContain(rel);
    });

    it('no fixed layer floats at its own height above the bottom: it uses the bar\'s room (BOTTOM_BAR_CLEARANCE)', () => {
        const offenders = ALL.flatMap(s => classStrings(s.text, 'fixed')
            .filter(c => !reachesBottom(c) && bottomOffset(c))
            .map(c => `${s.rel}: ${bottomOffset(c)}`));
        expect(offenders).toEqual([]);
    });

    it('a file that floats a fixed layer sets its `bottom` only to the bar\'s room', () => {
        const offenders: string[] = [];
        for (const s of ALL) {
            const floating = classStrings(s.text, 'fixed').filter(c => !reachesBottom(c));
            if (floating.length === 0) continue;
            for (const m of s.text.matchAll(/\bbottom:\s*([^,}\n]+)/g)) {
                if (m[1].trim() !== 'BOTTOM_BAR_CLEARANCE') offenders.push(`${s.rel}: bottom: ${m[1].trim()}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('no sticky footer: `sticky … bottom-*` would stick under the bar', () => {
        const offenders = ALL.flatMap(s => classStrings(s.text, 'sticky')
            .filter(c => tokens(c).some(t => /^bottom-/.test(t)))
            .map(c => `${s.rel}: ${c}`));
        expect(offenders).toEqual([]);
    });
});

describe('FOOT-1 — every page\'s last line can scroll clear of the bar', () => {
    it('the app\'s ONE scroll area ends with the bar\'s whole room (not 6rem, which stopped 8px under the raised button)', () => {
        const app = readFileSync(resolve(SRC, 'AppContent.tsx'), 'utf-8');
        const main = app.slice(app.indexOf('<main'), app.indexOf('</main>'));
        expect(main).toMatch(/paddingBottom: isKeyboardOpen \? '1\.5rem' : BOTTOM_BAR_CLEARANCE/);
        expect(main).not.toContain('6rem');
    });

    it('the bar draws its row at the same height the room is counted from', () => {
        const nav = readFileSync(resolve(SRC, 'features/context/components/BottomNavigation.tsx'), 'utf-8');
        expect(nav).toContain('style={{ height: BOTTOM_BAR_ROW_PX }}');
        expect(nav).not.toContain('h-[78px]');
    });
});
