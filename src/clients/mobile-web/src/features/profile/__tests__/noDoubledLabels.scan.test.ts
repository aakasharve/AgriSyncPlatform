/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, P-3 / MU-5) — founder rule: plain Marathi on
 * farmer screens, never a Marathi label doubled with its English twin ("पूर्ण नाव · Full Name").
 * A source scan of the ओळख card and the team screen: any Marathi text followed by " · " and an
 * English word is a doubled label. (Marathi joined to Marathi — "काम सांगणे · हजेरी" — is fine.)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd(); // vitest root = src/clients/mobile-web
const SURFACES = [
    join(ROOT, 'src', 'features', 'profile', 'sections', 'IdentitySection.tsx'),
    join(ROOT, 'src', 'features', 'profile', 'team', 'teamCopy.ts'),
    join(ROOT, 'src', 'features', 'profile', 'team', 'TeamPage.tsx'),
    join(ROOT, 'src', 'features', 'profile', 'team', 'TeamPersonCard.tsx'),
    join(ROOT, 'src', 'features', 'profile', 'team', 'JoinRequestCard.tsx'),
    join(ROOT, 'src', 'features', 'profile', 'team', 'ReasonStep.tsx'),
    join(ROOT, 'src', 'features', 'profile', 'team', 'FarmCodeCard.tsx'),
];

/** Marathi (Devanagari) text, then " · ", then an English word on the same line. */
const DOUBLED = /[ऀ-ॿ][^\n'"`{}]*?\s·\s[A-Za-z]{2,}/u;

describe('no doubled Marathi / English labels on the ओळख card and the team screen', () => {
    it.each(SURFACES)('%s', file => {
        const offending = readFileSync(file, 'utf8')
            .split(/\r?\n/)
            .map((line, i) => ({ line: line.trim(), n: i + 1 }))
            .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*') && DOUBLED.test(line));
        expect(offending).toEqual([]);
    });

    it('the scan catches the shape it exists for (control)', () => {
        expect(DOUBLED.test('<p>पूर्ण नाव · Full Name</p>')).toBe(true);
        expect(DOUBLED.test("'जोडत आहे… · Connecting…'")).toBe(true);
        expect(DOUBLED.test("tellWork: 'काम सांगणे · हजेरी'")).toBe(false);
    });
});
