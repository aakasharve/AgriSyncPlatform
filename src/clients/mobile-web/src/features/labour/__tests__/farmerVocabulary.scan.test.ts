// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 5 Task 5.3 (founder master review 2026-09-02, D5): "No farmer-facing
 * permission vocabulary, ever: not permission, grant, role, claim, policy,
 * access." The ON-state reads "कामगारांची जबाबदारी आहे" — never a hardcoded
 * English ON/OFF.
 *
 * Farmer-facing means: any string literal containing Devanagari, and any JSX
 * text node, in the Labour feature and on the two authority surfaces
 * (TeamMemberCard, IdentitySection) that D5 re-copies. Code identifiers,
 * class names, testids and attribute values stay out of scope — the farmer
 * never reads them.
 *
 * Source-scan idiom copied from dexieVersionIntegrity.test.ts: cwd-rooted,
 * comments stripped first, and the scope asserted non-empty so a wrong cwd
 * can never pass vacuously.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd(); // vitest root = src/clients/mobile-web
const LABOUR_DIR = join(ROOT, 'src', 'features', 'labour');
const AUTHORITY_SURFACES = [
    join(ROOT, 'src', 'features', 'profile', 'components', 'TeamMemberCard.tsx'),
    join(ROOT, 'src', 'features', 'profile', 'sections', 'IdentitySection.tsx'),
];

const PERMISSION_VOCAB = /\b(permissions?|grants?|granted|roles?|claims?|polic(?:y|ies)|access)\b/i;
const HARDCODED_ON_OFF = /(?<![A-Za-z])(?:ON|OFF)(?![A-Za-z])/; // uppercase only — 'on'/'off' prose stays legal
const DEVANAGARI = /[ऀ-ॿ]/;

function collect(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        if (name === '__tests__' || name === 'node_modules') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...collect(full));
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
    }
    return out;
}

/** Same caveat as dexieVersionIntegrity: prose must never fail (or pass) a scan. */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[^\S\r\n]*\/\/.*$/gm, '');
}

/** (i) Devanagari-bearing string literals; (ii) JSX text nodes. */
function farmerFacingStrings(source: string): string[] {
    const stripped = stripComments(source);
    const out: string[] = [];

    const literal = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
    for (const m of stripped.matchAll(literal)) {
        // Interpolation placeholders (`${ON_PHONE_MR}`) are code identifiers,
        // not farmer-visible text — the farmer sees the resolved VALUE, and
        // that value's own literal is scanned at its definition site. Left in,
        // the identifier's ON tripped HARDCODED_ON_OFF (ReviewSheet.tsx).
        const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, '');
        if (DEVANAGARI.test(text)) out.push(text);
    }

    // JSX text: between a closing '>' and the next '<', containing no braces
    // (expressions) — filtered of code-looking captures so `a > b && c < d`
    // fragments can only false-NEGATIVE, never false-positive.
    const jsxText = />([^<>{}]+)</g;
    for (const m of stripped.matchAll(jsxText)) {
        const text = m[1].trim();
        // Latin-or-Devanagari as two tests: ESLint's no-misleading-
        // character-class forbids a combining mark sharing a class with
        // base characters, so the doc's single class is split. Same match.
        if (text.length > 0 && (/[A-Za-z]/.test(text) || DEVANAGARI.test(text)) && !/[();=]/.test(text)) {
            out.push(text);
        }
    }
    return out;
}

describe('farmer-facing labour vocabulary (D5: no permission words, no English ON/OFF)', () => {
    const files = [...collect(LABOUR_DIR), ...AUTHORITY_SURFACES.filter(existsSync)];

    it('the scan scope is non-empty', () => {
        // A moved directory must break the scan loudly, not hollow it out.
        expect(files.length).toBeGreaterThan(10);
        expect(AUTHORITY_SURFACES.every(existsSync)).toBe(true);
    });

    it('no farmer-facing labour string contains permission vocabulary or a hardcoded English ON/OFF', () => {
        const offenders: string[] = [];
        for (const file of files) {
            for (const text of farmerFacingStrings(readFileSync(file, 'utf8'))) {
                if (PERMISSION_VOCAB.test(text) || HARDCODED_ON_OFF.test(text)) {
                    offenders.push(`${file.slice(ROOT.length + 1)}: "${text}"`);
                }
            }
        }
        // The farmer's words are जबाबदारी द्या / कामगारांची जबाबदारी आहे —
        // permission, grant, role, claim, policy, access and hardcoded ON/OFF
        // are OUR words, and they may never reach his screen (founder master
        // review 2026-09-02, D5).
        expect(offenders).toEqual([]);
    });
});
