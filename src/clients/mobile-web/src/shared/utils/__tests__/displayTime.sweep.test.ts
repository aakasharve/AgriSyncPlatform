// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (twelve-hour-time-display)
 *
 * STRUCTURAL GUARD — parses the syntax tree and asks the type checker.
 *
 * ─── WHAT IT CATCHES ────────────────────────────────────────────────────────
 * Transcribed from `displayTime.sweep.detector.ts` AFTER it was finished, rule
 * by rule, rather than from the design I had in mind while writing it. Three
 * rounds of findings have been a sentence the code did not support, twice in
 * the sentence describing the fix, so the order matters.
 *
 *   · `x.toLocaleTimeString(…)` and `x.toTimeString(…)` — ANY receiver, no
 *     type check at all
 *   · `d.toLocaleString(…)` where the checker says `d` is a `Date`
 *   · `d.toLocaleDateString(…)` on a `Date`, when the SECOND argument can carry
 *     a time part. Only the second: the first is the locale, and testing it too
 *     is what made `toLocaleDateString(undefined, {date-only})` report itself
 *   · `Intl.DateTimeFormat(…)`, with or without `new`, whose SECOND argument
 *     can carry a time part
 *   · `hour12: false` and `timeStyle:` in ANY object literal, anywhere
 *   · `x.toISOString().slice(11, …)`
 *
 * "Can carry a time part" is `hasTimeOption`, and it answers:
 *   · a plain or shorthand key in `TIME_OPTION_NAMES`            -> yes
 *   · a computed key that is a string literal in that set        -> yes
 *   · a computed key the checker CANNOT read                     -> yes (unsafe)
 *   · a SPREAD whose type has such a property                    -> yes
 *   · any non-object-literal whose TYPE has such a property      -> yes
 *   · a type with no readable properties at all                  -> yes (unsafe)
 *   · `undefined`, `null`, `void`, or a string                   -> NO
 *
 * Method names are read through dotted OR bracketed access, so
 * `d['toLocaleTimeString']()` is the same rule. `Intl.DateTimeFormat` is
 * recognised by the CONSTRUCTOR'S TYPE as well as by name, so
 * `const DTF = Intl.DateTimeFormat` and `const { DateTimeFormat } = Intl` are
 * caught. A `Date` behind a union TYPE ALIAS is caught by walking the union —
 * `typeToString` renders `MaybeDate`, which a `\bDate\b` test misses.
 *
 * ─── WHAT IT DOES NOT CATCH ─────────────────────────────────────────────────
 *   · HAND-ROLLED ARITHMETIC — `getHours()` with `padStart`, or any manual
 *     hour maths. Not a formatter call, so there is nothing to key on.
 *     `getHours` is deliberately NOT banned: `DateKeyService` uses the UTC
 *     variants legitimately.
 *   · A method name assembled at RUNTIME — `d[someVariable]()`. Only string
 *     literals are resolved.
 *   · A `Date` reaching a formatter through `any`, or through a module the
 *     checker cannot resolve.
 *   · `toLocaleString` on a receiver the checker types as something other than
 *     `Date` — which is what keeps the ~28 money call sites quiet, and is a
 *     limit as much as a feature.
 *   · Anything outside `src/`, and the exempt files below.
 *
 * ─── WHY IT IS SHAPED THIS WAY ──────────────────────────────────────────────
 * v1 required the token `hour` inside the argument list, so it could not see
 * `toLocaleString()` and passed green over two live clocks. v2 keyed on the
 * literal text `new Date(` within 200 characters — a longer spelling, not a
 * different kind of check — and six forms walked through it. Both failures were
 * the same: proximity is not structure. That is also why v2's money exclusion
 * was never scoped to numbers; it was scoped to "not spelled `new Date(…)`
 * inline", which is simultaneously why date paths slipped through and why any
 * money call site was one stray `timeZone:` from failing spuriously.
 *
 * ─── HOW THE COVERAGE CLAIM IS SUBSTANTIATED ────────────────────────────────
 * Every rule above is exercised by a fixture below, scanned by the SAME
 * detector that scans the repository. The property claimed is: DISABLING ANY
 * SINGLE RULE REDDENS AT LEAST ONE NAMED ASSERTION HERE.
 *
 * That was measured, not assumed — each of the twelve rules was disabled in
 * turn and the suite re-run. It did NOT hold before this round for
 * `toLocaleTimeString` (the rule this whole task began with), `hour12: false`,
 * `timeStyle:`, or the union-alias branch of `isDateTyped`: all four could be
 * deleted with the suite still green.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

import { collectFindings, isDateTyped, type Finding } from './displayTime.sweep.detector';

const SRC = join(process.cwd(), 'src');
const FORMATTER_HOME = join('shared', 'utils', 'displayTime.ts');

/**
 * `cropEmojis.ts` only re-exports the helper. The detector module is itself
 * exempt: it names the methods it forbids.
 */
const EXEMPT = [
    FORMATTER_HOME,
    join('shared', 'utils', 'cropEmojis.ts'),
    join('__tests__', 'displayTime.sweep.detector.ts'),
];

function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__mocks__' || entry === 'node_modules') continue;
            sourceFiles(full, acc);
        } else if (/\.tsx?$/.test(entry)) {
            acc.push(full);
        }
    }
    return acc;
}

const COMPILER_OPTIONS: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowJs: true,
};

const ALL_FILES = sourceFiles(SRC);
const SCANNED = ALL_FILES.filter(f =>
    !EXEMPT.some(x => f.includes(x)) && !f.includes(`${join('', '__tests__', '')}`));

const program = ts.createProgram(ALL_FILES, COMPILER_OPTIONS);
const FINDINGS = collectFindings(program, SCANNED, SRC);
const format = (f: Finding) => `${f.file}:${f.line} [${f.why}] ${f.text}`;

/** Scan a source string with the SAME detector the repository scan uses. */
function scanText(text: string): Finding[] {
    const NAME = join(SRC, '__fixture__.ts');
    // TypeScript asks its host for FORWARD-slash paths even on Windows, so this
    // must normalise or the override never fires and every fixture assertion
    // passes on an empty scan. It did, once.
    const norm = (f: string) => f.split(String.fromCharCode(92)).join('/');
    const isFixture = (f: string) => norm(f) === norm(NAME);

    const host = ts.createCompilerHost(COMPILER_OPTIONS);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
        isFixture(fileName)
            ? ts.createSourceFile(fileName, text, languageVersion, true)
            : original(fileName, languageVersion, onError, shouldCreate);
    host.fileExists = (f) => isFixture(f) || ts.sys.fileExists(f);
    host.readFile = (f) => (isFixture(f) ? text : ts.sys.readFile(f));

    return collectFindings(ts.createProgram([NAME], COMPILER_OPTIONS, host), [NAME], SRC);
}

// ---------------------------------------------------------------------------
// FIXTURES. Each rule the detector has must appear in one of these.
// ---------------------------------------------------------------------------

/** The six forms that walked through the v2 text matcher. */
const ESCAPED_V2 = `
const d = new Date();
const hoisted = d;
const bag = { hour: 'numeric' } as Intl.DateTimeFormatOptions;
export const a = hoisted.toLocaleString();
export const b = d.toLocaleDateString('en-IN', { day: 'numeric', hour: 'numeric' });
export const c = Intl.DateTimeFormat('en-IN', { hour: 'numeric' }).format(d);
export const e = new Intl.DateTimeFormat('en-IN', bag).format(d);
export const f = d.toTimeString();
export const g = d.toISOString().slice(11, 16);
`;

/**
 * The rules that had NO fixture until this round, so disabling them reddened
 * nothing (B006) — plus the money case that makes the by-type exclusion a real
 * assertion rather than a filter over an empty array (B005).
 */
const PRIMARY_RULES = `
const d = new Date();
const amount = 1234.5;
export const clock = d.toLocaleTimeString('en-IN');
export const forced = d.toLocaleString('en-IN', { hour: 'numeric', hour12: false });
export const styled = d.toLocaleString('en-IN', { timeStyle: 'short' });
export const money = amount.toLocaleString('en-IN');
export const moneyPlain = amount.toLocaleString();
`;

/** Spellings that evade a text matcher (B004, B007). */
const EVASIONS = `
const d = new Date();
const TIME_OPTS = { hour: 'numeric' as const, minute: '2-digit' as const };
const DTF = Intl.DateTimeFormat;
const { DateTimeFormat } = Intl;
export const spread = new Intl.DateTimeFormat('en-GB', { ...TIME_OPTS }).format(d);
export const bracket = d['toLocaleTimeString']();
export const aliased = new DTF('en-GB', { hour: 'numeric' }).format(d);
export const destructured = new DateTimeFormat('en-GB', { hour: 'numeric' }).format(d);
export const computed = new Intl.DateTimeFormat('en-GB', { ['hour']: 'numeric' }).format(d);
`;

/**
 * A `Date` hidden behind a UNION TYPE ALIAS, reached by optional chaining.
 *
 * B008's branch exists for exactly this and had no fixture, so disabling it left
 * the suite green. Measured: for `type MaybeDate = Date | null`, `typeToString`
 * renders the ALIAS NAME `MaybeDate`, which `/Date/` does not match — the
 * direct check misses it and only the union walk finds the `Date` constituent.
 * For a plain `Date | null` the direct check already matches, which is why this
 * needs the alias to be load-bearing at all.
 */
const ALIASED_UNION = `
type MaybeDate = Date | null;
declare const maybe: MaybeDate;
export const viaAlias = maybe?.toLocaleString();
`;

/** A Date and a number side by side — the by-type discrimination, isolated. */
const DATE_VS_NUMBER = `
const d = new Date();
const n = 42;
export const dateOne = d.toLocaleString();
export const numberOne = n.toLocaleString();
`;

describe('the scanner can see, and the fixtures are really parsed', () => {
    it('built a program over the source tree', () => {
        expect(SCANNED.length).toBeGreaterThan(300);
        expect(program.getSourceFile(SCANNED[0])).toBeDefined();
    });

    it('B005 — isDateTyped is actually exercised, and discriminates', () => {
        // The old version of this test asserted only that some file's TEXT
        // contained `new Date(` — it never called `isDateTyped` at all, while
        // its name and comment claimed to be the anti-vacuity guard. It is now
        // a real discrimination: two `toLocaleString` calls, one on a Date and
        // one on a number, and exactly one is flagged.
        const found = scanText(DATE_VS_NUMBER);
        expect(found).toHaveLength(1);
        expect(found[0].text).toContain('d.toLocaleString');
        expect(found[0].why).toContain('toLocaleString on a Date');
    });

    it('B005 — isDateTyped answers directly, on both sides', () => {
        // Called straight, so the function cannot be dead while the suite is green.
        const NAME = join(SRC, '__probe__.ts');
        const text = 'const d = new Date(); const n = 42; export const x = [d, n];';
        const host = ts.createCompilerHost(COMPILER_OPTIONS);
        const norm = (f: string) => f.split(String.fromCharCode(92)).join('/');
        const original = host.getSourceFile.bind(host);
        host.getSourceFile = (f, v, e, c) =>
            norm(f) === norm(NAME) ? ts.createSourceFile(f, text, v, true) : original(f, v, e, c);
        host.fileExists = (f) => norm(f) === norm(NAME) || ts.sys.fileExists(f);
        host.readFile = (f) => (norm(f) === norm(NAME) ? text : ts.sys.readFile(f));

        const prog = ts.createProgram([NAME], COMPILER_OPTIONS, host);
        const sf = prog.getSourceFile(NAME)!;
        const chk = prog.getTypeChecker();
        const elements: ts.Expression[] = [];
        const walk = (n: ts.Node): void => {
            if (ts.isArrayLiteralExpression(n)) elements.push(...n.elements);
            ts.forEachChild(n, walk);
        };
        walk(sf);

        expect(elements).toHaveLength(2);
        expect(isDateTyped(elements[0], chk)).toBe(true);
        expect(isDateTyped(elements[1], chk)).toBe(false);
    });
});

describe('no user-facing clock bypasses the shared 12-hour formatter', () => {
    it('nothing formats a time outside shared/utils/displayTime', () => {
        expect(
            FINDINGS.map(format),
            'Use shared/utils/displayTime — it pins IST and 12-hour AM/PM. This check reads '
            + 'the syntax tree and asks the type checker what the receiver is, so it does not '
            + 'care how the call was spelled.',
        ).toEqual([]);
    });
});

describe('COVERAGE PROOF — every rule is exercised by a fixture', () => {
    const escaped = scanText(ESCAPED_V2);
    const primary = scanText(PRIMARY_RULES);
    const evasions = scanText(EVASIONS);

    it('the fixtures were parsed — not silently empty', () => {
        expect(escaped.length, 'ESCAPED_V2 produced nothing').toBeGreaterThan(0);
        expect(primary.length, 'PRIMARY_RULES produced nothing').toBeGreaterThan(0);
        expect(evasions.length, 'EVASIONS produced nothing').toBeGreaterThan(0);
    });

    // --- the six that escaped v2 ---
    it('catches a Date hoisted to a variable', () => {
        expect(escaped.some(f => f.why.includes('toLocaleString on a Date'))).toBe(true);
    });
    it('catches toLocaleDateString carrying time options', () => {
        expect(escaped.some(f => f.why.includes('toLocaleDateString carrying time options'))).toBe(true);
    });
    it('catches Intl.DateTimeFormat written without new', () => {
        expect(escaped.some(f => f.text.startsWith('Intl.DateTimeFormat'))).toBe(true);
    });
    it('catches an options bag hoisted beyond any character window', () => {
        expect(escaped.some(f => f.text.includes('bag'))).toBe(true);
    });
    it('catches toTimeString', () => {
        expect(escaped.some(f => f.why.includes('toTimeString'))).toBe(true);
    });
    it('catches a hand-rolled clock from toISOString().slice(11, …)', () => {
        expect(escaped.some(f => f.why.includes('hand-rolled 24-hour clock'))).toBe(true);
    });

    // --- B006: the rules that had no fixture at all ---
    it('B006 — catches toLocaleTimeString, the rule this whole task began with', () => {
        expect(primary.some(f => f.why.includes('toLocaleTimeString'))).toBe(true);
    });
    it('B006 — catches hour12: false', () => {
        expect(primary.some(f => f.why.includes('hour12: false'))).toBe(true);
    });
    it('B006 — catches timeStyle', () => {
        expect(primary.some(f => f.why.includes('timeStyle'))).toBe(true);
    });

    // --- B004 / B007: the evasions ---
    it('B004 — catches time options arriving via SPREAD', () => {
        expect(evasions.some(f => f.text.includes('...TIME_OPTS'))).toBe(true);
    });
    it('B007 — catches a bracketed method name', () => {
        expect(evasions.some(f => f.text.includes("['toLocaleTimeString']"))).toBe(true);
    });
    it('B007 — catches an aliased Intl.DateTimeFormat', () => {
        expect(evasions.some(f => f.text.includes('new DTF('))).toBe(true);
    });
    it('B007 — catches a destructured DateTimeFormat', () => {
        expect(evasions.some(f => f.text.includes('new DateTimeFormat('))).toBe(true);
    });
    it('B007 — catches a computed option key', () => {
        expect(evasions.some(f => f.text.includes("['hour']"))).toBe(true);
    });

    it('B008 — catches a Date behind a union TYPE ALIAS via optional chaining', () => {
        // The union branch of `isDateTyped`. Without a fixture, disabling that
        // branch left every assertion green — the same uncovered-rule shape as
        // B006, one function deeper.
        const found = scanText(ALIASED_UNION);
        expect(found.map(f => f.why)).toContain(
            'toLocaleString on a Date renders a device-locale date AND time');
    });
});

describe('B005 — money is excluded BY TYPE, asserted against a fixture', () => {
    it('a number through toLocaleString is not flagged, with or without a locale', () => {
        // The old version of this test filtered `FINDINGS`, which is `[]` on a
        // clean tree — `[].filter()` is always `[]`, so it asserted nothing. It
        // now runs against a fixture that really contains money calls.
        const found = scanText(PRIMARY_RULES);
        expect(found.filter(f => f.text.includes('amount')).map(format)).toEqual([]);
        // And the Date calls in that same fixture ARE flagged, so the fixture is
        // not simply being ignored.
        expect(found.some(f => f.text.includes('d.toLocaleTimeString'))).toBe(true);
    });
});
