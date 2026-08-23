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
 * by rule, rather than from the design I had in mind while writing it. Four
 * rounds of findings have been a sentence the code did not support, twice in
 * the sentence describing the fix, so the order matters.
 *
 *   · `x.toLocaleTimeString(…)` and `x.toTimeString(…)` — ANY receiver, of any
 *     type, with no type check at all, PROVIDED the callee is written as a
 *     direct member access: `x.toLocaleTimeString()` or
 *     `x['toLocaleTimeString']()`. It is not "any spelling": the rule reads
 *     `callExpression.expression` and requires that node to BE the member
 *     access. See the DOES NOT CATCH list for the callee shapes this excludes;
 *     each of them was measured, not assumed
 *   · `d.toLocaleString(…)` where the checker says `d` is a `Date`
 *   · `d.toLocaleDateString(…)` on a `Date`, when the SECOND argument can carry
 *     a time part. Only the second — the first is the locale. An earlier version
 *     read `arguments[0]` as well, and together with the spread widening that
 *     made `LogCard.tsx:41` —
 *     `date.toLocaleDateString(undefined, { weekday, day, month })` — report
 *     itself. The `undefined` guard added at the same time would now stop that
 *     one on its own; the index was wrong regardless, so the rule reads only
 *     the second
 *   · `Intl.DateTimeFormat(…)`, with or without `new`, whose SECOND argument
 *     can carry a time part
 *   · `hour12: false` and `timeStyle:` in ANY object literal, anywhere
 *   · `x.toISOString().slice(11, …)` — and only `11`. `slice(0, 10)` is the
 *     DATE half and is deliberately left alone: `VoiceDiaryPage.tsx:84` and
 *     `:85`, `TestDetailPage.tsx:78` and `:308`, and `DemoDataService.ts:104`
 *     each write one. (`DateKeyService` is NOT one of them — it builds its keys
 *     from `getUTC*` and `padStart`, which is the first DOES NOT CATCH bullet.)
 *
 * "Can carry a time part" is `hasTimeOption`, and it answers:
 *   · a plain or shorthand key in `TIME_OPTION_NAMES`            -> yes
 *   · a computed key that is a string literal in that set        -> yes
 *   · a computed key that is a string literal NOT in that set    -> NO
 *   · a computed key the checker CANNOT read                     -> yes (unsafe)
 *   · a SPREAD whose type has such a property                    -> yes
 *   · any non-object-literal whose TYPE has such a property      -> yes
 *   · a type with no readable properties at all                  -> yes (unsafe)
 *   · an ABSENT second argument                                  -> NO
 *   · `undefined`, `null`, or `void`                             -> NO
 *   · a locale string or a locale array                          -> NO
 *
 * `TIME_OPTION_NAMES` is exactly `hour`, `minute`, `second`, `timeStyle`,
 * `hour12`, `dayPeriod`. Each of the six now has an options bag of its own
 * below. Before that, a name was invisible to the suite unless some fixture
 * carried it ALONE — every bag holding `minute` also held `hour` — and the
 * round-4 review measured `minute`, `second` and `dayPeriod` as deletable from
 * the set with the whole suite still green.
 *
 * The LAST row is the one row with no line of its own. There used to be a
 * `StringLike -> false` guard; measured, the checker reads 50 properties off
 * `string` and 35 off `string[]`, none of them a time option, so the rows above
 * it already answer NO. B009 deleted that guard rather than keep a rule no
 * fixture could redden. The row is still asserted below — for behaviour, not
 * for mutation cover.
 *
 * Method names are read through dotted OR bracketed access, so
 * `d['toLocaleTimeString']()` is the same rule. `Intl.DateTimeFormat` is
 * recognised by NAME through either access — `Intl['DateTimeFormat']` included
 * — and by the CONSTRUCTOR'S TYPE, so `const DTF = Intl.DateTimeFormat` and
 * `const { DateTimeFormat } = Intl` are caught. A `Date` behind a union TYPE
 * ALIAS is caught by walking the union — `typeToString` renders `MaybeDate`,
 * which a `\bDate\b` test misses.
 *
 * ─── WHAT IT DOES NOT CATCH ─────────────────────────────────────────────────
 *   · HAND-ROLLED ARITHMETIC — `getHours()` with `padStart`, or any manual
 *     hour maths. Not a formatter call, so there is nothing to key on.
 *     `getHours` is deliberately NOT banned: `DateKeyService` uses the UTC
 *     variants legitimately.
 *   · A method name assembled at RUNTIME — `d[someVariable]()`. Only string
 *     literals are resolved.
 *   · A CALLEE THAT IS NOT A DIRECT MEMBER ACCESS. Two spellings, both measured
 *     clean: `(d.toLocaleTimeString)()`, where the call's expression is a
 *     PARENTHESISED expression and the rule does not unwrap it; and
 *     `d.toLocaleTimeString.bind(d)` invoked later, where the call's expression
 *     is a plain identifier. Any other indirection through a reference behaves
 *     the same. This is the exact width of the "ANY receiver" claim above: the
 *     RECEIVER is unconstrained, the CALLEE's shape is not. Neither spelling
 *     appears anywhere in `src/` today.
 *   · A `Date` behind a BARE GENERIC PARAMETER —
 *     `function f<T extends Date>(t: T) { return t.toLocaleString(); }`.
 *     Measured clean: `typeToString` renders `T`, which `\bDate\b` misses, and
 *     `T` is not a union, so the union walk has nothing to walk. The CONSTRAINT
 *     is not followed. A union type ALIAS is followed, which is a different
 *     thing. Does not appear in the tree today.
 *   · A `Date` reaching a formatter through `any`, or through a module the
 *     checker cannot resolve.
 *   · `toLocaleString` on a receiver the checker types as something other than
 *     `Date` — which is what keeps the money call sites quiet. Counted, because
 *     the figure round 3 wrote here ("~28") did not match the tree:
 *     55 `.toLocaleString(` call sites across 29 scanned files, and the scan is
 *     clean, so the checker types every one of those receivers as a non-`Date`.
 *     A limit as much as a feature.
 *   · Anything outside `src/`; every path whose name contains `__tests__`,
 *     which `SCANNED` drops wholesale; the `__mocks__` and `node_modules`
 *     directories, which the walker never descends into; and the three EXEMPT
 *     files listed below.
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
 * detector that scans the repository — the sole exception being the last row of
 * the answer table, called out there, which describes an OUTCOME with no line
 * of its own left to disable. The property claimed is: DISABLING ANY SINGLE
 * RULE REDDENS AT LEAST ONE NAMED ASSERTION HERE.
 *
 * MEASURED, and the measurement is the whole point of the sentence. FORTY-TWO
 * single-rule mutations were applied to the detector one at a time and the
 * suite re-run after each, from a green baseline: 42 red, 0 survivors. The
 * mutation list — anchor text and replacement for every one — is in the commit
 * message for this change, so the run can be replayed line for line. Each
 * mutation DISABLES one rule or removes one exclusion; nothing was counted
 * that was not run.
 *
 * Three of the forty-two redden the REPOSITORY scan and not merely a fixture:
 * making an absent options argument unsafe (M19), dropping the by-type money
 * exclusion from `toLocaleString` (M35), and dropping the start-must-be-11
 * exclusion from the `slice` rule (M38). Live call sites in `src/` depend on
 * each of those three, so the empty expectation below is empty because the tree
 * is clean, not because the scan is inert.
 *
 * Round 3 measured twelve and wrote the same sentence, and the round-4 review
 * ran twenty, of which eight survived. FIVE of the eight sat under four bullets
 * the answer table above enumerates and no fixture exercised; the other three
 * were names inside `TIME_OPTION_NAMES`. One of the five had teeth — deleting
 * `props.length === 0 -> unsafe` left the suite green while silently unflagging
 * every options bag typed `any` or `Record<string, unknown>`, a false-negative
 * direction the harness itself could not see.
 *
 * Round 3 also logged `(1)` red for "computed option key" against what was
 * really a TWO-rule mutation: `propertyKey`'s string-literal resolution and
 * `hasTimeOption`'s unreadable-key fallback MASK each other, and only disabling
 * both reddened that row. Each limb now has a fixture that isolates it, and
 * they are M09 and M22 of the forty-two.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

import {
    collectFindings, isDateTyped, TIME_OPTION_NAMES, type Finding,
} from './displayTime.sweep.detector';

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
// `join('', '__tests__', '')` normalises to the bare word `__tests__`, so this
// drops every path containing it — directory or filename — not just directories.
const SCANNED = ALL_FILES.filter(f =>
    !EXEMPT.some(x => f.includes(x)) && !f.includes(`${join('', '__tests__', '')}`));

const program = ts.createProgram(ALL_FILES, COMPILER_OPTIONS);
const FINDINGS = collectFindings(program, SCANNED, SRC);
const format = (f: Finding) => `${f.file}:${f.line} [${f.why}] ${f.text}`;

// Every scanText() call builds its own ts.Program, and a Program's dominant
// cost is parsing the ES2022 lib.*.d.ts declaration files -- tens of thousands
// of lines that are byte-identical on every call. With scanText() invoked from
// most assertions in this file, the suite spent nearly all its time re-reading
// unchanging declarations and left individual tests with no margin under
// vitest's 5000ms default. That is fine on an idle laptop and not fine on a
// loaded CI runner, where ci-gate.yml runs `npm test` as a BLOCKING step.
//
// So cache them. Only non-fixture files are cached: the fixture's text differs
// on every call and is deliberately never stored. Lib declaration files are
// immutable for the life of the process, so sharing the parsed SourceFile
// across programs is safe -- it is what TypeScript's own watch mode does.
const LIB_SOURCE_CACHE = new Map<string, ts.SourceFile | undefined>();

/**
 * A compiler host serving ONE in-memory fixture and cached lib declarations.
 *
 * Every caller that builds its own `ts.Program` must come through here. One
 * test previously hand-rolled this same host inline, which is how it kept
 * paying the full lib-parse cost after the cache landed and then timed out at
 * 6094ms against the 5000ms default — the caching fix had simply never reached
 * it. Sharing the host removes the duplication and the divergence together.
 */
function fixtureHost(name: string, text: string): ts.CompilerHost {
    // TypeScript asks its host for FORWARD-slash paths even on Windows, so this
    // must normalise or the override never fires and every fixture assertion
    // passes on an empty scan. It did, once.
    const norm = (f: string) => f.split(String.fromCharCode(92)).join('/');
    const isFixture = (f: string) => norm(f) === norm(name);

    const host = ts.createCompilerHost(COMPILER_OPTIONS);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
        if (isFixture(fileName)) {
            return ts.createSourceFile(fileName, text, languageVersion, true);
        }
        const key = norm(fileName);
        if (!LIB_SOURCE_CACHE.has(key)) {
            LIB_SOURCE_CACHE.set(
                key,
                original(fileName, languageVersion, onError, shouldCreate));
        }
        return LIB_SOURCE_CACHE.get(key);
    };
    host.fileExists = (f) => isFixture(f) || ts.sys.fileExists(f);
    host.readFile = (f) => (isFixture(f) ? text : ts.sys.readFile(f));
    return host;
}

/** Scan a source string with the SAME detector the repository scan uses. */
function scanText(text: string): Finding[] {
    const NAME = join(SRC, '__fixture__.ts');
    return collectFindings(
        ts.createProgram([NAME], COMPILER_OPTIONS, fixtureHost(NAME, text)), [NAME], SRC);
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
 * The rules that had NO fixture until round 3, so disabling them reddened
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
export const bracketCtor = new Intl['DateTimeFormat']('en-GB', { hour: 'numeric' }).format(d);
export const computed = new Intl.DateTimeFormat('en-GB', { ['hour']: 'numeric' }).format(d);
`;

/**
 * A `Date` hidden behind a UNION TYPE ALIAS, reached by optional chaining.
 *
 * B008's branch exists for exactly this and had no fixture, so disabling it left
 * the suite green. Measured: for `type MaybeDate = Date | null`, `typeToString`
 * renders the ALIAS NAME `MaybeDate`, which `/Date/` does not match — the
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

/**
 * B009 — every member of `TIME_OPTION_NAMES`, one name per options bag, so
 * removing any single name from the set reddens exactly one assertion. Until
 * this fixture existed, `minute`, `second` and `dayPeriod` could all be deleted
 * from the set with the suite green, because every bag that carried them also
 * carried `hour`.
 *
 * `hour12: TRUE` on purpose: `hour12: false` has a rule of its own and would
 * keep that line flagged with `hour12` gone from the set. `timeStyle` cannot be
 * isolated the same way — it too has its own rule — so its assertion matches on
 * the DateTimeFormat REASON rather than on the finding alone.
 */
const EVERY_TIME_OPTION = `
const d = new Date();
export const o1 = new Intl.DateTimeFormat('en-IN', { hour: 'numeric' }).format(d);
export const o2 = new Intl.DateTimeFormat('en-IN', { minute: '2-digit' }).format(d);
export const o3 = new Intl.DateTimeFormat('en-IN', { second: '2-digit' }).format(d);
export const o4 = new Intl.DateTimeFormat('en-IN', { timeStyle: 'short' }).format(d);
export const o5 = new Intl.DateTimeFormat('en-IN', { hour12: true }).format(d);
export const o6 = new Intl.DateTimeFormat('en-IN', { dayPeriod: 'short' }).format(d);
`;

/** The names asserted one-by-one below. Kept in step with the set by a test. */
const TIME_OPTION_FIXTURE_NAMES = [
    'hour', 'minute', 'second', 'timeStyle', 'hour12', 'dayPeriod',
] as const;

/**
 * B009 — the one survivor with teeth. `props.length === 0 -> unsafe` could be
 * deleted with the suite green, and deleting it silently stops flagging an
 * options bag the checker cannot read into: `any` and `Record<string, unknown>`
 * both have zero readable properties. That is a false-negative direction, so it
 * gets an assertion of its own.
 */
const UNREADABLE_OPTIONS = `
declare const loose: any;
declare const bag: Record<string, unknown>;
const d = new Date();
export const viaAny = new Intl.DateTimeFormat('en-IN', loose).format(d);
export const viaRecord = new Intl.DateTimeFormat('en-IN', bag).format(d);
`;

/**
 * B009 — `undefined`, `null` and `void` in the options slot, one per flag in
 * the `type.flags` mask. Take `Undefined` out of that mask and `undefined`'s
 * zero readable properties fall straight through to "unverifiable -> unsafe"
 * and it reports itself: precisely the false positive `LogCard` hit in round 3.
 *
 * The locale string and locale array are asserted for BEHAVIOUR, not for
 * mutation cover — no single line holds them up (see the header).
 *
 * The control keeps the whole thing from passing on an empty scan.
 */
const EMPTY_OPTIONS_SLOT = `
declare const nothing: null;
declare function nothingAtAll(): void;
declare const locale: string;
declare const locales: string[];
const d = new Date();
export const control = new Intl.DateTimeFormat('en-IN', { hour: 'numeric' }).format(d);
export const undef = new Intl.DateTimeFormat('en-IN', undefined).format(d);
export const nul = new Intl.DateTimeFormat('en-IN', nothing).format(d);
export const voided = new Intl.DateTimeFormat('en-IN', nothingAtAll()).format(d);
export const str = new Intl.DateTimeFormat('en-IN', locale).format(d);
export const arr = new Intl.DateTimeFormat('en-IN', locales).format(d);
`;

/**
 * B010 — the two computed-key limbs, which MASK each other.
 *
 * `propertyKey` resolving a computed string literal, and `hasTimeOption`
 * treating an unresolvable computed key as unsafe, both produce "flagged" for
 * `{ ['hour']: … }`, so disabling either alone left round 3's fixture green and
 * only disabling BOTH reddened it. Split here:
 *   · `['weekday']` isolates the RESOLUTION — with it disabled the key reads as
 *     null, the unsafe fallback fires, and a date-only bag is over-flagged
 *   · `[runtimeKey]` isolates the FALLBACK — the resolution already returns
 *     null for it, so only the fallback can flag it
 */
const COMPUTED_KEYS = `
declare const runtimeKey: string;
const d = new Date();
export const readable = new Intl.DateTimeFormat('en-IN', { ['hour']: 'numeric' }).format(d);
export const dateOnly = new Intl.DateTimeFormat('en-IN', { ['weekday']: 'short' }).format(d);
export const unreadable = new Intl.DateTimeFormat('en-IN', { [runtimeKey]: 'numeric' }).format(d);
`;

/**
 * B009 — the NEGATIVE side of three guards that nothing held up before:
 *   · an ABSENT second argument (`hasTimeOption`'s `!arg` short-circuit) —
 *     flip it and every date-only `toLocaleDateString(locale)` call reports
 *   · `slice` whose start is not `11` — flip it and `DateKeyService`'s
 *     `slice(0, 10)` date keys report
 *   · `slice` on a call that is not `toISOString()`
 * The control clock keeps the fixture from passing on an empty scan.
 */
const NOT_A_CLOCK = `
declare const other: { foo(): string };
const d = new Date();
export const control = d.toTimeString();
export const noOptions = d.toLocaleDateString('en-IN');
export const dateOptions = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const dateKey = d.toISOString().slice(0, 10);
export const notIso = other.foo().slice(11, 16);
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
        const prog = ts.createProgram([NAME], COMPILER_OPTIONS, fixtureHost(NAME, text));
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
    it('B009 — catches a bracketed Intl constructor', () => {
        // `Intl['DateTimeFormat']` is reached by the ELEMENT-ACCESS limb of the
        // name check, which had no fixture: the identifier/type limb cannot see
        // it, so removing that limb alone left the suite green.
        expect(evasions.some(f => f.text.includes("Intl['DateTimeFormat']"))).toBe(true);
    });
    it('B007 — catches a computed option key', () => {
        // Kept as the header's "computed string literal in the set -> yes" row.
        // It does NOT discriminate between the two limbs that produce it; the
        // B010 pair below does.
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

describe('B009 — every TIME_OPTION_NAME carries its own fixture', () => {
    const byOptions = scanText(EVERY_TIME_OPTION)
        .filter(f => f.why === 'Intl.DateTimeFormat whose options can carry a time part');

    it('the fixture list and the set are the same list', () => {
        // So a name ADDED to the set without a fixture is caught too, not only
        // a name removed.
        expect([...TIME_OPTION_FIXTURE_NAMES].sort())
            .toEqual([...TIME_OPTION_NAMES].sort());
    });

    for (const name of TIME_OPTION_FIXTURE_NAMES) {
        it(`catches an options bag whose only time key is ${name}`, () => {
            expect(byOptions.some(f => f.text.includes(`${name}:`))).toBe(true);
        });
    }

    it('does NOT call hour12: TRUE a 24-hour clock', () => {
        // The `FalseKeyword` half of that rule. `hour12: true` belongs in the
        // set — it can carry a time part — but it is not the thing the rule
        // forbids, and nothing asserted the difference before.
        expect(scanText(EVERY_TIME_OPTION).map(f => f.why))
            .not.toContain('hour12: false asks for a 24-hour clock');
    });
});

describe('B009 — the hasTimeOption answer table, row by row', () => {
    it('an options bag the checker cannot read into is treated as UNSAFE', () => {
        // The survivor with teeth: delete `props.length === 0 -> true` and both
        // of these go quiet with every named assertion still green.
        const texts = scanText(UNREADABLE_OPTIONS).map(f => f.text);
        expect(texts).toContain("new Intl.DateTimeFormat('en-IN', loose)");
        expect(texts).toContain("new Intl.DateTimeFormat('en-IN', bag)");
    });

    it('undefined, null, void, a locale string and a locale array are NOT clocks', () => {
        // Exactly one finding: the control. Anything else here is a false
        // positive of the kind that made LogCard report itself in round 3.
        expect(scanText(EMPTY_OPTIONS_SLOT).map(f => f.text)).toEqual([
            "new Intl.DateTimeFormat('en-IN', { hour: 'numeric' })",
        ]);
    });

    it('B010 — a computed key the checker CAN read decides on its own name', () => {
        const texts = scanText(COMPUTED_KEYS).map(f => f.text);
        expect(texts).toContain("new Intl.DateTimeFormat('en-IN', { ['hour']: 'numeric' })");
        expect(texts).not.toContain("new Intl.DateTimeFormat('en-IN', { ['weekday']: 'short' })");
    });

    it('B010 — a computed key the checker CANNOT read is treated as UNSAFE', () => {
        expect(scanText(COMPUTED_KEYS).map(f => f.text))
            .toContain("new Intl.DateTimeFormat('en-IN', { [runtimeKey]: 'numeric' })");
    });

    it('B009 — an absent bag, a date-only bag, slice(0, 10) and a non-ISO slice are clean', () => {
        expect(scanText(NOT_A_CLOCK).map(f => f.text)).toEqual(['d.toTimeString()']);
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
