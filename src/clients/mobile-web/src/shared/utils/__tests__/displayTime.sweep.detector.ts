/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (twelve-hour-time-display)
 *
 * The detector behind `displayTime.sweep.test.ts`, extracted so the SAME code
 * that scans the repository also scans the fixtures that prove what it catches.
 * A proof that runs a different code path is not a proof.
 *
 * Every rule here is keyed on the syntax tree and, where it matters, on what
 * the TYPE CHECKER says a value is — never on how a call was spelled. The
 * accompanying test states the exact boundary; this file is the thing that
 * boundary must be read from.
 */
import ts from 'typescript';

/**
 * Time-of-day option names.
 *
 * `timeZone` is deliberately absent. It is a modifier, not a clock: pinning
 * `timeZone` on a DATE formatter is the correct fix for the date/time split in
 * `WeatherWidget` and `mainView`, so flagging it would forbid the right thing.
 *
 * B009 — each of the six has an options bag of its OWN in the harness. Before
 * that, `minute`, `second` and `dayPeriod` could each be deleted from this set
 * with the whole suite green, because every fixture carrying them also carried
 * `hour`. Adding a name here without adding it to `TIME_OPTION_FIXTURE_NAMES`
 * reddens the harness on purpose.
 */
export const TIME_OPTION_NAMES = new Set([
    'hour', 'minute', 'second', 'timeStyle', 'hour12', 'dayPeriod',
]);

export interface Finding {
    file: string;
    line: number;
    text: string;
    why: string;
}

/** The property name a member expression reads, whether dotted or bracketed. */
function memberName(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    const arg = node.argumentExpression;
    return arg && ts.isStringLiteralLike(arg) ? arg.text : null;
}

/** A property key, whether plain, shorthand, or a computed string literal. */
function propertyKey(p: ts.ObjectLiteralElementLike): string | null {
    if (!p.name) return null;
    if (ts.isComputedPropertyName(p.name)) {
        return ts.isStringLiteralLike(p.name.expression) ? p.name.expression.text : null;
    }
    return p.name.getText();
}

/** Does this expression's static type include `Date`? Asked of the checker. */
export function isDateTyped(node: ts.Expression, chk: ts.TypeChecker): boolean {
    const type = chk.getTypeAtLocation(node);
    if (/\bDate\b/.test(chk.typeToString(type))) return true;
    // B008 — this branch used the module-level checker even when a different
    // program's checker was passed, so scanning a fixture asked the repository's
    // checker about a fixture type. It uses `chk` now, like everything else.
    return type.isUnion() && type.types.some(t => /\bDate\b/.test(chk.typeToString(t)));
}

/** Can a value of this expression's TYPE carry a time-of-day part? */
export function typeCanCarryTimeOptions(arg: ts.Expression, chk: ts.TypeChecker): boolean {
    // An absent bag carries nothing. Without this, `undefined` reaches the
    // "no resolvable properties -> unverifiable -> unsafe" branch below and is
    // reported. `LogCard` passes `undefined` in the LOCALE slot with a
    // date-only options object, and the first version of this rule flagged it —
    // a false positive introduced by the B004 fix itself.
    const type = chk.getTypeAtLocation(arg);
    if (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) {
        return false;
    }

    // B009 — an explicit `StringLike -> false` guard used to sit here, for a
    // LOCALE written into the options slot. Measured, it could not change a
    // single answer: the checker reads 50 properties off `string` and off a
    // string literal type, and 35 off `string[]`, none of them a time option,
    // so the two lines below already answer NO. A line that cannot change an
    // outcome cannot be disabled either, which made it the one part of this
    // function no fixture could ever redden. Deleted rather than excused.
    const props = chk.getPropertiesOfType(type).map(p => p.getName());
    // No resolvable properties means the checker could not read it. Treat that
    // as unverifiable, which is the unsafe direction. This is the line that
    // catches an options bag typed `any` or `Record<string, unknown>`.
    if (props.length === 0) return true;
    return props.some(name => TIME_OPTION_NAMES.has(name));
}

/**
 * Does this options argument carry a time-of-day part?
 *
 * B004 — SPREAD USED TO DEFEAT THIS ENTIRELY. The old version looked only at
 * `PropertyAssignment` and `ShorthandPropertyAssignment`, and because a spread
 * still arrives inside an `ObjectLiteralExpression`, the type-based fallback in
 * the caller was never reached: `new Intl.DateTimeFormat('en-GB', { ...TIME_OPTS })`
 * scanned clean. There was no live instance. Counted, though: `displayTime.ts`
 * spreads options in FOUR places — `...options` straight into the
 * `new Intl.DateTimeFormat(…)` argument at line 76, and `...TIME_OPTS` /
 * `...TIME_SECONDS_OPTS` at lines 85, 86 and 88. That file is EXEMPT, so none
 * of the four is a miss; the spelling is one copy-paste out of the exempt file
 * from being one. (Round 3 said "three times" here. It is four.)
 */
export function hasTimeOption(arg: ts.Expression | undefined, chk: ts.TypeChecker): boolean {
    if (!arg) return false;
    if (!ts.isObjectLiteralExpression(arg)) return typeCanCarryTimeOptions(arg, chk);

    return arg.properties.some(p => {
        if (ts.isSpreadAssignment(p)) {
            // Ask the checker what the spread expression's type contains.
            return typeCanCarryTimeOptions(p.expression, chk);
        }
        const key = propertyKey(p);
        // A computed key the checker cannot read is unverifiable -> unsafe.
        if (key === null) return !!p.name && ts.isComputedPropertyName(p.name);
        return TIME_OPTION_NAMES.has(key);
    });
}

/** Is this callee `Intl.DateTimeFormat`, however it was reached? */
function isDateTimeFormatCallee(callee: ts.Expression, chk: ts.TypeChecker): boolean {
    if ((ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
        && memberName(callee) === 'DateTimeFormat') {
        return true;
    }
    // B007 — `const DTF = Intl.DateTimeFormat` and `const { DateTimeFormat } = Intl`
    // are the same constructor under another name. The checker knows that even
    // though the text does not say `Intl`.
    if (ts.isIdentifier(callee)) {
        return /DateTimeFormatConstructor/.test(chk.typeToString(chk.getTypeAtLocation(callee)));
    }
    return false;
}

export function collectFindings(prog: ts.Program, files: readonly string[], srcRoot: string): Finding[] {
    const found: Finding[] = [];
    const chk = prog.getTypeChecker();

    for (const file of files) {
        const sf = prog.getSourceFile(file);
        if (!sf) continue;

        const at = (node: ts.Node, why: string): Finding => {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            return {
                file: sf.fileName.replace(/\\/g, '/').replace(srcRoot.replace(/\\/g, '/'), 'src'),
                line: line + 1,
                text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 90),
                why,
            };
        };

        const visit = (node: ts.Node): void => {
            // `Intl.DateTimeFormat(...)`, with or without `new`, however named.
            if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
                if (isDateTimeFormatCallee(node.expression, chk)) {
                    const options = node.arguments?.[1];
                    if (options && hasTimeOption(options, chk)) {
                        found.push(at(node, 'Intl.DateTimeFormat whose options can carry a time part'));
                    }
                }
            }

            // A method call on something, dotted or bracketed.
            if (ts.isCallExpression(node)
                && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))) {
                const method = memberName(node.expression);
                const receiver = node.expression.expression;

                if (method === 'toLocaleTimeString' || method === 'toTimeString') {
                    found.push(at(node, `${method} renders a device-locale clock`));
                } else if (method === 'toLocaleString' && isDateTyped(receiver, chk)) {
                    found.push(at(node, 'toLocaleString on a Date renders a device-locale date AND time'));
                } else if (method === 'toLocaleDateString'
                    && isDateTyped(receiver, chk)
                    // `(locales, options)` — options is the SECOND argument, and
                    // ONLY the second. An earlier version also tested
                    // `arguments[0]`, which is the locale; combined with the
                    // spread fix that made `toLocaleDateString(undefined, {…})`
                    // report itself.
                    && hasTimeOption(node.arguments[1], chk)) {
                    found.push(at(node, 'toLocaleDateString carrying time options'));
                } else if (method === 'slice'
                    && ts.isCallExpression(receiver)
                    && (ts.isPropertyAccessExpression(receiver.expression)
                        || ts.isElementAccessExpression(receiver.expression))
                    && memberName(receiver.expression) === 'toISOString'
                    && node.arguments[0]?.getText(sf) === '11') {
                    found.push(at(node, 'toISOString().slice(11, …) is a hand-rolled 24-hour clock'));
                }
            }

            // Object-literal properties that are wrong wherever they appear.
            // In the AST rather than in a text scan so the fixtures below cover
            // them and a disabled rule reddens something (B006).
            if (ts.isPropertyAssignment(node)) {
                const key = propertyKey(node);
                if (key === 'hour12' && node.initializer.kind === ts.SyntaxKind.FalseKeyword) {
                    found.push(at(node, 'hour12: false asks for a 24-hour clock'));
                } else if (key === 'timeStyle') {
                    found.push(at(node, 'timeStyle formats a clock outside the shared formatter'));
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(sf);
    }

    return found.sort((a, b) => `${a.file}:${a.line}`.localeCompare(`${b.file}:${b.line}`));
}
