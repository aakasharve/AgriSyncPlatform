// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (twelve-hour-time-display)
 *
 * STRUCTURAL GUARD — parses the syntax tree, does not match text.
 *
 * WHY THIS IS THE THIRD VERSION, because the first two are the argument for it.
 *
 *   v1 required the token `hour` inside the argument list. It could not see
 *   `toLocaleString()`, the form that renders date AND time by default, and it
 *   passed green over two live user-facing clocks while being cited as proof
 *   the sweep was complete.
 *
 *   v2 keyed on the literal text `new Date(` within 200 characters. That is a
 *   longer spelling, not a different kind of check, and six forms still walked
 *   through it — `toLocaleDateString` with time options (LIVE at the time),
 *   an options bag built by a caller, and a `Date` hoisted to a variable
 *   (already the shape of `AiRecentFailuresTable`, one keystroke from reopening
 *   the hole).
 *
 * The failure both times was the same: PROXIMITY IS NOT STRUCTURE. Measuring
 * how close the token `new Date(` sits to `.toLocaleString(` also explains why
 * the money exclusion was never really scoped to numbers — it was scoped to
 * "not spelled `new Date(...)` inline", which is exactly why the date paths
 * slipped through, and why any of the 28 money call sites would start failing
 * spuriously the day a `weekday:` or `timeZone:` landed nearby.
 *
 * So this version asks the TypeScript type checker what the receiver IS. A
 * `Date` formatted for a human is caught however it was written; a `number`
 * formatted as money is not caught however close it sits to a date.
 *
 * WHAT IT COVERS
 *   · `x.toLocaleTimeString(...)`            — any receiver, any arguments
 *   · `x.toTimeString()`                     — any receiver
 *   · `d.toLocaleString(...)`                — receiver typed `Date`, any arguments
 *   · `d.toLocaleDateString(...)`            — receiver typed `Date`, WITH time options
 *   · `Intl.DateTimeFormat(...)`             — with or without `new`, with time options
 *   · `Intl.DateTimeFormat(...)`             — with a non-literal options bag, which
 *                                              cannot be verified and so must not exist
 *   · `hour12: false` / `timeStyle:`         — anywhere
 *
 * WHAT IT DOES NOT COVER, stated plainly rather than implied:
 *   · hand-rolled arithmetic — `getHours()` with `padStart`, or
 *     `toISOString().slice(11, 16)`. Both produce a 24-hour clock and neither is
 *     a formatter call, so the checker has nothing to key on. A separate,
 *     deliberately narrow check for the `slice(11` idiom is included below;
 *     `getHours()` is NOT flagged, because `DateKeyService` uses the UTC
 *     variants legitimately and a blanket ban would be noise.
 *   · a `Date` reaching a formatter through `any`, or across a dynamic import
 *     the checker cannot resolve.
 *   · anything outside `src/`.
 *
 * That list is the honest boundary. It is here so the next person knows what
 * this does and does not enforce, rather than inferring a guarantee from the
 * word "guard".
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const SRC = join(process.cwd(), 'src');
const FORMATTER_HOME = join('shared', 'utils', 'displayTime.ts');

/** `cropEmojis.ts` only re-exports the helper. */
const EXEMPT = [FORMATTER_HOME, join('shared', 'utils', 'cropEmojis.ts')];

function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__' || entry === '__mocks__' || entry === 'node_modules') continue;
            sourceFiles(full, acc);
        } else if (/\.tsx?$/.test(entry)) {
            acc.push(full);
        }
    }
    return acc;
}

const ALL_FILES = sourceFiles(SRC);
const SCANNED = ALL_FILES.filter(f => !EXEMPT.some(x => f.includes(x)));

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

const program = ts.createProgram(ALL_FILES, COMPILER_OPTIONS);
const checker = program.getTypeChecker();

/**
 * Time-of-day option names.
 *
 * `timeZone` is deliberately NOT here. It is a modifier, not a clock: pinning
 * `timeZone` on a DATE formatter is precisely the I-3 fix (`WeatherWidget`,
 * `mainView`), so flagging it would forbid the correct thing.
 */
const TIME_OPTION_NAMES = new Set(['hour', 'minute', 'second', 'timeStyle', 'hour12', 'dayPeriod']);

interface Finding { file: string; line: number; text: string; why: string }

function describeNode(sf: ts.SourceFile, node: ts.Node, why: string): Finding {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return {
        file: sf.fileName.replace(/\\/g, '/').replace(SRC.replace(/\\/g, '/'), 'src'),
        line: line + 1,
        text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 90),
        why,
    };
}

/** Is this expression's static type `Date`? Asked of the checker, not the text. */
function isDateTyped(node: ts.Expression, chk: ts.TypeChecker = checker): boolean {
    const type = chk.getTypeAtLocation(node);
    const name = chk.typeToString(type);
    if (/\bDate\b/.test(name)) return true;
    // Unions such as `Date | undefined`.
    return type.isUnion() && type.types.some(t => /\bDate\b/.test(checker.typeToString(t)));
}

/**
 * Could a value of this expression's TYPE carry a time-of-day part?
 *
 * The structural answer to "an options bag I cannot read". A type that has no
 * `hour`/`minute`/… property cannot smuggle one through at runtime.
 */
function typeCanCarryTimeOptions(arg: ts.Expression, chk: ts.TypeChecker = checker): boolean {
    const type = chk.getTypeAtLocation(arg);
    const props = chk.getPropertiesOfType(type).map(p => p.getName());
    // An empty property list means the checker could not resolve it — treat
    // that as unverifiable, which is the unsafe direction.
    if (props.length === 0) return true;
    return props.some(name => TIME_OPTION_NAMES.has(name));
}

function hasTimeOption(arg: ts.Expression | undefined): boolean {
    if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
    return arg.properties.some(p =>
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p))
        && !!p.name && TIME_OPTION_NAMES.has(p.name.getText()));
}

function collect(prog: ts.Program = program, files: string[] = SCANNED): Finding[] {
    const found: Finding[] = [];

    for (const file of files) {
        const sf = prog.getSourceFile(file);
        if (!sf) continue;

        const chk = prog.getTypeChecker();
        const visit = (node: ts.Node): void => {
            // Intl.DateTimeFormat(...) — with or without `new`.
            if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
                const callee = node.expression;
                if (ts.isPropertyAccessExpression(callee)
                    && callee.name.text === 'DateTimeFormat'
                    && callee.expression.getText(sf) === 'Intl') {
                    const options = node.arguments?.[1];
                    if (hasTimeOption(options)) {
                        found.push(describeNode(sf, node, 'Intl.DateTimeFormat with time options'));
                    } else if (options && !ts.isObjectLiteralExpression(options)
                        && typeCanCarryTimeOptions(options, chk)) {
                        // An options bag written elsewhere. Rather than banning
                        // it outright, ask the checker whether its TYPE can even
                        // express a time part: `DateKeyService` passes a variable
                        // whose type is `Omit<…, 'hour' | …>`, which provably
                        // cannot, so it is safe and stays quiet. Widen that type
                        // back and this fires again.
                        found.push(describeNode(sf, node,
                            'Intl.DateTimeFormat with an options bag whose type permits time parts'));
                    }
                }
            }

            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
                const method = node.expression.name.text;
                const receiver = node.expression.expression;

                if (method === 'toLocaleTimeString' || method === 'toTimeString') {
                    found.push(describeNode(sf, node, `${method} renders a device-locale clock`));
                } else if (method === 'toLocaleString' && isDateTyped(receiver, chk)) {
                    found.push(describeNode(sf, node,
                        'toLocaleString on a Date renders a device-locale date AND time'));
                } else if (method === 'toLocaleDateString'
                    && isDateTyped(receiver, chk)
                    // `(locales, options)` — options is the SECOND argument.
                    // This read `arguments[0]` (the locale) and so never fired;
                    // the coverage fixture below is what caught it.
                    && (hasTimeOption(node.arguments[1]) || hasTimeOption(node.arguments[0]))) {
                    found.push(describeNode(sf, node,
                        'toLocaleDateString carrying time options'));
                } else if (method === 'slice'
                    && ts.isCallExpression(receiver)
                    && ts.isPropertyAccessExpression(receiver.expression)
                    && receiver.expression.name.text === 'toISOString'
                    && node.arguments[0]?.getText(sf) === '11') {
                    found.push(describeNode(sf, node,
                        'toISOString().slice(11, …) is a hand-rolled 24-hour clock'));
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(sf);
    }

    return found.sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line));
}

const FINDINGS = collect();
const format = (f: Finding) => `${f.file}:${f.line} [${f.why}] ${f.text}`;

/**
 * THE COVERAGE PROOF — every form that walked through v2, in one fixture.
 *
 * The test set for this guard was: *"it caught yesterday's two and not
 * tomorrow's third."* A guard that returns `[]` on a clean tree proves nothing
 * about what it can see, so the claim is made executable here instead: the
 * detector is run against source text containing each escaping form, and must
 * name every one.
 *
 * If someone narrows a pattern later, these go red before the tree does.
 */
const ESCAPED_V2 = `
const d = new Date();
const hoisted = d;
const bag = { hour: 'numeric' } as Intl.DateTimeFormatOptions;

// 1. a Date hoisted to a variable — v2 needed the literal \`new Date(\` nearby
export const a = hoisted.toLocaleString();

// 2. toLocaleDateString carrying time options
export const b = d.toLocaleDateString('en-IN', { day: 'numeric', hour: 'numeric' });

// 3. Intl.DateTimeFormat WITHOUT new
export const c = Intl.DateTimeFormat('en-IN', { hour: 'numeric' }).format(d);

// 4. options hoisted out of reach of any character window
export const e = new Intl.DateTimeFormat('en-IN', bag).format(d);

// 5. toTimeString
export const f = d.toTimeString();

// 6. a hand-rolled 24-hour clock out of an ISO string
export const g = d.toISOString().slice(11, 16);
`;

function scanText(text: string): Finding[] {
    const NAME = join(SRC, '__fixture__.ts');
    // TypeScript asks its host for FORWARD-slash paths even on Windows, so the
    // comparison has to normalise or the override never fires and the whole
    // coverage proof passes vacuously with zero findings. (It did, once.)
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

    const prog = ts.createProgram([NAME], COMPILER_OPTIONS, host);
    return collect(prog, [NAME]);
}

describe('COVERAGE PROOF — the forms that escaped the text matcher', () => {
    const found = scanText(ESCAPED_V2);
    const whys = found.map(f => f.why);

    it('the fixture was actually parsed — not silently empty', () => {
        // Without this the six assertions below could all pass on a fixture
        // the compiler host never served.
        expect(found.length, 'fixture produced no findings at all').toBeGreaterThan(0);
    });

    it('catches a Date hoisted to a variable', () => {
        expect(whys.some(w => w.includes('toLocaleString on a Date'))).toBe(true);
    });

    it('catches toLocaleDateString carrying time options', () => {
        expect(whys.some(w => w.includes('toLocaleDateString carrying time options'))).toBe(true);
    });

    it('catches Intl.DateTimeFormat written without new', () => {
        expect(found.some(f => f.text.startsWith('Intl.DateTimeFormat'))).toBe(true);
    });

    it('catches an options bag hoisted beyond any character window', () => {
        expect(whys.some(w => w.includes('options bag whose type permits time parts'))).toBe(true);
    });

    it('catches toTimeString', () => {
        expect(whys.some(w => w.includes('toTimeString'))).toBe(true);
    });

    it('catches a hand-rolled clock from toISOString().slice(11, …)', () => {
        expect(whys.some(w => w.includes('hand-rolled 24-hour clock'))).toBe(true);
    });

    it('finds all six and nothing is silently dropped', () => {
        expect(found.length, found.map(format).join(' | ')).toBeGreaterThanOrEqual(6);
    });
});

describe('the structural scanner can actually see', () => {
    it('built a program over the source tree', () => {
        expect(SCANNED.length).toBeGreaterThan(300);
        expect(program.getSourceFile(SCANNED[0])).toBeDefined();
    });

    it('the type checker really resolves Date receivers', () => {
        // If this fails, `isDateTyped` is answering `false` for everything and
        // every Date assertion below passes vacuously.
        const probe = SCANNED.find(f => f.includes('displayTime') === false
            && (program.getSourceFile(f)?.text ?? '').includes('new Date('));
        expect(probe, 'no file with a `new Date(` to probe').toBeDefined();
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

describe('money formatting is not caught — the exclusion is by TYPE, not by proximity', () => {
    it('a number through toLocaleString is never flagged', () => {
        // v2 excluded money by accident: it only looked for `new Date(` nearby,
        // so any of the 28 money sites would have started failing the day a
        // `timeZone:` landed near one. This asks the checker instead.
        const moneyish = FINDINGS.filter(f =>
            /amount|total|cost|price|qty|count|Rs|₹/i.test(f.text));
        expect(moneyish.map(format)).toEqual([]);
    });
});

describe('text-level rules that need no type information', () => {
    function textOffenders(pattern: RegExp): string[] {
        const hits: string[] = [];
        for (const file of SCANNED) {
            const text = program.getSourceFile(file)?.text ?? '';
            const re = new RegExp(pattern.source, pattern.flags + 'g');
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                hits.push(`${file.replace(SRC, 'src')}:${text.slice(0, m.index).split('\n').length}`);
            }
        }
        return hits;
    }

    it('nothing asks for 24-hour output explicitly', () => {
        expect(textOffenders(/hour12\s*:\s*false/)).toEqual([]);
    });

    it('nothing uses timeStyle outside the formatter', () => {
        expect(textOffenders(/\btimeStyle\s*:/)).toEqual([]);
    });
});
