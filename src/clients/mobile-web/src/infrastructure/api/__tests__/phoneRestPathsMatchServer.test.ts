/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1 (F100; review F-1), hardened in fix pass 2
 * (review N-3).
 *
 * Every REST path the phone calls must be a route the server has, with the method the phone uses. The phone called 18
 * that it did not (a missing `/shramsafal` prefix, or a path that never existed), and a 19th hid in an image `src`
 * (N-2): each screen failed, and nothing noticed.
 *
 * HOW: the phone's own source is read with the TypeScript compiler (never by hand-kept lists).
 *   1. A CALL: a template or a `+` concatenation that starts with an API base (`${resolveBaseUrl()}/…`, `base + '/…'`,
 *      or a helper in the same file that is itself such a base plus text, like `apiBase()` = `${resolveBaseUrl()}/shramsafal`),
 *      or the first argument of an axios call on the API transport (`t.http.get('/…')`) or of `apiFetch` / `fetch`.
 *      Its METHOD is read too: the axios verb, or the literal `method` of the fetch's options (followed from a
 *      `const url = …` in the same function), GET when none is given.
 *   2. ANY STRING ANYWHERE (a call, a constant, an image `src`) that looks like a server path: its first segment is one of
 *      the server's top-level segments (`/shramsafal/…`, `/user/…`), one of the second-level segments under `/shramsafal`
 *      (`/job-cards/…`, `/attachments/…`: exactly the missing-prefix failure), or `/api/…`. So a missing `/shramsafal`
 *      fails on its own, however the string is used.
 *   3. A template that starts with a base this test does not know, followed by such a path, fails as unreadable until
 *      the base is named here.
 * Each path (`${…}` = any value, the query string dropped) must match a route in the server's route table, and a call
 * whose method is known must match that route's method.
 *
 * THE TABLE: `sync-contract/routes/server-rest-routes.txt`. The server test `ServerRouteTableTests` runs the real
 * Bootstrapper with `--list-routes` (every endpoint of the built production host, read after Program.cs has mapped
 * everything) and FAILS when the file differs; regenerate with AGRISYNC_WRITE_ROUTE_TABLE=1. A mapping removed from
 * Program.cs therefore leaves the table, and this test then fails on any phone call to it.
 */
import ts from 'typescript';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
// The phone source read: this checkout's `src`. AGRISYNC_PHONE_SRC_ROOT points it at another copy of the phone's `src`
// (how the lane proved this test red on the source before the fix); never set in CI.
const SRC = process.env.AGRISYNC_PHONE_SRC_ROOT || join(HERE, '..', '..', '..');

function repoRoot(): string {
    let dir = HERE;
    for (let i = 0; i < 12; i++) {
        if (existsSync(join(dir, 'sync-contract', 'routes'))) return dir;
        dir = dirname(dir);
    }
    throw new Error('sync-contract/routes not found above this test');
}

const TABLE_PATH = join(repoRoot(), 'sync-contract', 'routes', 'server-rest-routes.txt');

interface Route { method: string; path: string }

/** The server's route table ("METHOD /path"; `*` answers every method). */
function serverRoutes(): Route[] {
    return readFileSync(TABLE_PATH, 'utf8')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#'))
        .map(l => ({ method: l.slice(0, l.indexOf(' ')), path: l.slice(l.indexOf(' ') + 1) }));
}

/**
 * A path the phone still has that the server does not, kept on purpose with its reason, keyed "file path". An entry here
 * must still be a mismatch (the test fails when it is fixed, so the entry is removed with the fix).
 */
const CARRIED: Record<string, string> = {
    // Review row 17: the crop-schedule-template picker (the compliance model, not the library the phone lists). Lane
    // L8b-1 kept it out of the flow: the schedule-in-planning integration is held by founder D-24e2 (plan question L8-3).
    'infrastructure/api/resources/ScheduleResource.ts /shramsafal/reference-data/crop-schedule-templates':
        'row 17: held by D-24e2 (L8-3)',
};

/**
 * Text that looks like a server path but is never requested, keyed "file path", with its reason. Kept as short as
 * possible: an entry silences only that one text in that one file.
 */
const NOT_A_CALL: Record<string, string> = {
    // Made-up rows the admin ops preview draws (an error row's endpoint, as text); nothing is requested from it.
    'features/admin/ops/AdminOpsPreview.tsx /shramsafal/sync/push': 'preview data, never requested',
    // A document bundled with the app (public/consent/agreement_{mr,en}.md), read from the app itself, not the API.
    'features/consent/ConsentAgreement.tsx /consent/agreement_{…}.md': 'bundled document in public/consent',
    // Fragments matched against the URL of a request that already failed (which failures to report); never requested.
    'infrastructure/telemetry/ClientErrorReporter.ts /logs': 'a failed-URL fragment, never requested',
    'infrastructure/telemetry/ClientErrorReporter.ts /ai/parse-voice': 'a failed-URL fragment, never requested',
    'infrastructure/telemetry/ClientErrorReporter.ts /ai/voice-parse': 'a failed-URL fragment, never requested',
    'infrastructure/telemetry/ClientErrorReporter.ts /ai/receipt-extract': 'a failed-URL fragment, never requested',
    'infrastructure/telemetry/ClientErrorReporter.ts /ai/patti-extract': 'a failed-URL fragment, never requested',
    'infrastructure/telemetry/ClientErrorReporter.ts /ai/document-sessions': 'a failed-URL fragment, never requested',
};

/** A `${…}` span inside a phone path. */
const ANY = '\u0000';

/** The API base expressions (the API's origin, nothing more). */
const ORIGIN_BASES = new Set(['resolveBaseUrl()', 'resolveApiBaseUrl()', 'baseUrl', 'base', 'API_BASE_URL', 'apiBaseUrl']);
const AXIOS_RECEIVER = /(^|\.)(http|authHttp|axiosClient)$/;
const AXIOS_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const FETCHES = new Set(['apiFetch', 'fetch']);

interface Found {
    file: string;
    path: string;
    line: number;
    /** Known for a call; null for a string that only looks like a server path. */
    method: string | null;
    /** True when a template starts with a base this test cannot read. */
    unreadableBase?: string;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === '__tests__' || name === 'node_modules') continue;
            sourceFiles(full, out);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

const bare = (text: string) => (text.endsWith('()') ? text.slice(0, -2) : text);

/** A `+` chain flattened into its parts, left to right (`a + '/x' + b` → [a, '/x', b]). */
function plusParts(node: ts.Expression): ts.Expression[] {
    if (ts.isParenthesizedExpression(node)) return plusParts(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        return [...plusParts(node.left), ...plusParts(node.right)];
    }
    return [node];
}

/** One part as text: a literal's own text, a template with its spans as ANY, anything else ANY. */
function partText(node: ts.Expression): string {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
        return node.head.text + node.templateSpans.map(s => ANY + s.literal.text).join('');
    }
    return ANY;
}

/**
 * A URL-building expression read as (its leading base expression, the text after it). A template is
 * `${base}` + rest; a `+` chain is base + rest. A plain literal has no base.
 */
function readUrl(node: ts.Expression, sf: ts.SourceFile): { base: string | null; rest: string } | null {
    if (ts.isTemplateExpression(node)) {
        if (node.head.text !== '') return { base: null, rest: partText(node) };
        const rest = node.templateSpans.map((s, i) => (i === 0 ? '' : ANY) + s.literal.text).join('');
        return { base: node.templateSpans[0].expression.getText(sf), rest };
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const parts = plusParts(node);
        const first = parts[0];
        if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first) || ts.isTemplateExpression(first)) {
            return { base: null, rest: parts.map(partText).join('') };
        }
        return { base: first.getText(sf), rest: parts.slice(1).map(partText).join('') };
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { base: null, rest: node.text };
    return null;
}

/** `name` → the literal path it adds to the API origin, for a name that is itself used to start a path in the file. */
function fileBases(sf: ts.SourceFile): Map<string, string> {
    const startsPaths = new Set<string>();
    const collect = (node: ts.Node): void => {
        if (ts.isTemplateExpression(node) || ts.isBinaryExpression(node)) {
            const url = readUrl(node as ts.Expression, sf);
            if (url?.base && url.rest.startsWith('/')) startsPaths.add(bare(url.base));
        }
        node.forEachChild(collect);
    };
    collect(sf);
    const bases = new Map<string, string>();
    let grew = true;
    while (grew) {
        grew = false;
        const visit = (node: ts.Node): void => {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
                && startsPaths.has(node.name.text) && !bases.has(node.name.text)) {
                let body: ts.Node = node.initializer;
                if (ts.isArrowFunction(body) && !ts.isBlock(body.body)) body = body.body;
                const url = readUrl(body as ts.Expression, sf);
                if (url?.base && !url.rest.includes(ANY) && url.rest.startsWith('/')) {
                    const prefix = ORIGIN_BASES.has(url.base) ? '' : bases.get(bare(url.base));
                    if (prefix !== undefined) {
                        bases.set(node.name.text, prefix + url.rest);
                        grew = true;
                    }
                }
            }
            node.forEachChild(visit);
        };
        visit(sf);
    }
    return bases;
}

/** The literal `method` of a fetch's options object, GET when there is none, null when it cannot be read. */
function fetchMethod(options: ts.Expression | undefined): string | null {
    if (!options) return 'GET';
    if (!ts.isObjectLiteralExpression(options)) return null;
    for (const p of options.properties) {
        if (ts.isPropertyAssignment(p) && p.name.getText() === 'method') {
            return ts.isStringLiteral(p.initializer) ? p.initializer.text.toUpperCase() : null;
        }
        if (ts.isSpreadAssignment(p)) return null;
    }
    return 'GET';
}

/** The `const name = <url>` this identifier names, in its enclosing function (or the file). */
function declaredUrl(id: ts.Identifier): ts.Expression | null {
    let scope: ts.Node = id;
    while (scope.parent && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
    let found: ts.Expression | null = null;
    const look = (node: ts.Node): void => {
        if (found) return;
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === id.text && node.initializer) {
            found = node.initializer;
            return;
        }
        node.forEachChild(look);
    };
    look(scope);
    return found;
}

function phonePaths(suspectSegments: Set<string>, serverRoots: Set<string>): Found[] {
    const found: Found[] = [];
    for (const file of sourceFiles(SRC)) {
        const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
            file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const bases = fileBases(sf);
        const rel = relative(SRC, file).split(sep).join('/');
        const line = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const seen = new Set<ts.Node>();

        // Methods of the URLs that fetch / axios calls send, for the url expressions they name.
        const methodOf = new Map<ts.Node, string | null>();
        const calls = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && node.arguments.length > 0) {
                const callee = node.expression;
                let method: string | null | undefined;
                if (ts.isPropertyAccessExpression(callee) && AXIOS_VERBS.has(callee.name.text)
                    && AXIOS_RECEIVER.test(callee.expression.getText(sf))) {
                    method = callee.name.text.toUpperCase();
                } else if (ts.isIdentifier(callee) && FETCHES.has(callee.text)) {
                    method = fetchMethod(node.arguments[1]);
                }
                if (method !== undefined) {
                    const arg = node.arguments[0];
                    const target = ts.isIdentifier(arg) ? declaredUrl(arg) : arg;
                    // A bare `fetch` of an app-relative path reads the app's own files (bundled documents); only rule 2
                    // (a string that looks like a server path) applies to it. `apiFetch` always goes to the API.
                    const appRelative = callee.getText(sf) === 'fetch' && target !== null && readUrl(target, sf)?.base == null;
                    if (target && !appRelative) methodOf.set(target, method);
                }
            }
            node.forEachChild(calls);
        };
        calls(sf);

        const add = (node: ts.Node, path: string, method: string | null, unreadableBase?: string) => {
            seen.add(node);
            found.push({ file: rel, path, line: line(node), method, unreadableBase });
        };
        const looksLikeServerPath = (text: string) => {
            const segment = text.match(/^\/([A-Za-z_-]+)(?:[/?#]|$)/)?.[1];
            return segment !== undefined && (serverRoots.has(segment) || suspectSegments.has(segment) || segment === 'api');
        };

        const visit = (node: ts.Node): void => {
            if (seen.has(node)) return;
            const isUrlShaped = ts.isTemplateExpression(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
                || (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
                    && !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken));
            if (isUrlShaped) {
                const url = readUrl(node as ts.Expression, sf);
                const method = methodOf.has(node) ? methodOf.get(node)! : null;
                if (url && url.base) {
                    const prefix = ORIGIN_BASES.has(url.base) ? '' : bases.get(bare(url.base));
                    const declaresBase = ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)
                        && bases.has(node.parent.name.text)
                        || (ts.isArrowFunction(node.parent) && ts.isVariableDeclaration(node.parent.parent)
                            && ts.isIdentifier(node.parent.parent.name) && bases.has(node.parent.parent.name.text));
                    if (!declaresBase && url.rest.startsWith('/')) {
                        if (prefix !== undefined) {
                            add(node, prefix + url.rest, method);
                            return;
                        }
                        // 3. An unknown base followed by something that looks like a server path cannot be read.
                        if (looksLikeServerPath(url.rest)) {
                            add(node, url.rest, method, url.base);
                            return;
                        }
                    }
                } else if (url && (methodOf.has(node) || looksLikeServerPath(url.rest))) {
                    // A call's own path (rule 1), or ANY string that looks like a server path (rule 2).
                    if (url.rest.startsWith('/')) {
                        add(node, url.rest, method);
                        return;
                    }
                }
            }
            node.forEachChild(visit);
        };
        visit(sf);
    }
    return found;
}

/** The path part only: no query string or fragment (a span that carries the query is dropped with it). */
function pathOnly(path: string): string {
    const cut = path.search(/[?#]/);
    return cut === -1 ? path : path.slice(0, cut);
}

/** Does the phone path (ANY = some value) name this server route template? Segment by segment. */
function matches(phone: string, route: string): boolean {
    const p = pathOnly(phone).replace(/\/+$/, '').split('/');
    const r = route.replace(/\/+$/, '').split('/');
    if (p.length !== r.length) return false;
    return p.every((seg, i) => {
        const routeSeg = r[i];
        if (routeSeg.startsWith('{')) return seg.length > 0;
        if (!seg.includes(ANY)) return seg === routeSeg;
        // A span inside a literal segment: any text there (a trailing span may carry the query string).
        const pattern = seg.split(ANY).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        return new RegExp(`^${pattern}$`).test(routeSeg);
    });
}

function served(f: Found, routes: Route[]): boolean {
    return routes.some(r => matches(f.path, r.path) && (f.method === null || r.method === '*' || r.method === f.method));
}

const show = (path: string) => pathOnly(path).split(ANY).join('{…}');

describe('lane F99 (F100, N-3): every phone REST path is a route the server has, with its method', () => {
    const routes = serverRoutes();
    const roots = new Set(routes.map(r => r.path.split('/')[1]).filter(Boolean));
    const underShramSafal = new Set(routes.map(r => r.path.split('/')).filter(s => s[1] === 'shramsafal' && s[2]).map(s => s[2]));
    const found = phonePaths(underShramSafal, roots);
    // A path made only of spans (`${base}${path}`, a generic helper) names nothing on its own; it is not checkable here.
    const checkable = found
        .filter(f => /^\/[a-z_]/i.test(pathOnly(f.path)))
        .filter(f => !(`${f.file} ${show(f.path)}` in NOT_A_CALL));

    it('reads a real table and finds the phone\'s calls, with their methods (or it proves nothing)', () => {
        expect(routes.length).toBeGreaterThan(150);
        expect(roots.has('shramsafal')).toBe(true);
        expect(underShramSafal.has('job-cards')).toBe(true);
        expect(checkable.length).toBeGreaterThan(60);
        const shown = checkable.map(f => `${f.method ?? '?'} ${f.file} ${show(f.path)}`);
        // One per way of building a path: a file base helper, an axios call, a `const url` followed into fetch.
        expect(shown).toContain('POST features/work/data/jobCardsClient.ts /shramsafal/job-cards/{…}/start');
        expect(shown).toContain('GET infrastructure/api/resources/AuthResource.ts /user/auth/me/context');
        expect(shown).toContain('POST features/dataRights/ErasureRequestScreen.tsx /shramsafal/me/erasure/request');
        expect(shown.some(s => s.startsWith('POST infrastructure/api/resources/SyncResource.ts /sync/'))).toBe(true);
        // spec: plr-d10 lane SCH-GATE-b - the stage panel's call (a helper that builds the path; the server's `GetPlotStagePlan` route has it).
        expect(shown.some(s => s.endsWith('features/scheduler/schedulePage/stagePlanClient.ts /shramsafal/farms/{…}/plots/{…}/stage-plan'))).toBe(true);
        // spec: plr-d10 lane ATT-W - "पुढे ठरवा" on a step a followed schedule asks: the server's `MoveScheduleStep` route, with the method the phone uses.
        expect(shown).toContain('POST features/attention/data/rescheduleStep.ts /shramsafal/farms/{…}/schedule-steps/move');
        expect(routes).toContainEqual({ method: 'POST', path: '/shramsafal/farms/{farmId:guid}/schedule-steps/move' });
    });

    it('no phone path is missing from the server, and no call uses a method the route does not answer', () => {
        const unreadable = checkable.filter(f => f.unreadableBase)
            .map(f => `${f.file}:${f.line} \${${f.unreadableBase}}${show(f.path)} (name this base in the test)`);
        expect(unreadable, 'a path built on a base this test cannot read').toEqual([]);

        const missing = checkable
            .filter(f => !served(f, routes))
            .map(f => `${f.file}:${f.line} ${f.method ?? '(any)'} ${show(f.path)}`);
        const carriedKeys = Object.keys(CARRIED);
        const unexplained = missing.filter(m => !carriedKeys.some(k => {
            const [file, path] = k.split(' ');
            return m.startsWith(`${file}:`) && m.endsWith(` ${path}`);
        }));
        expect(unexplained, 'phone paths the server has no route for (fix the path, or the server route)').toEqual([]);

        // A carried entry must still be a real mismatch: when it is fixed, remove it from CARRIED.
        for (const k of carriedKeys) {
            const [file, path] = k.split(' ');
            expect(missing.some(m => m.startsWith(`${file}:`) && m.endsWith(` ${path}`)), `carried entry still open: ${k}`).toBe(true);
        }
    });
});

describe('the reader and the matcher', () => {
    const scan = (code: string) => {
        const sf = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const out: string[] = [];
        const visit = (node: ts.Node): void => {
            if (ts.isVariableDeclaration(node) && node.initializer) {
                const url = readUrl(node.initializer, sf);
                if (url) out.push(`${url.base ?? ''}|${show(url.rest)}`);
            }
            node.forEachChild(visit);
        };
        visit(sf);
        return out;
    };

    it('reads a template, a `+` chain and a literal the same way', () => {
        expect(scan('const a = `${resolveBaseUrl()}/shramsafal/job-cards/${id}`;')).toEqual(['resolveBaseUrl()|/shramsafal/job-cards/{…}']);
        expect(scan("const b = resolveBaseUrl() + '/shramsafal/job-cards/' + id;")).toEqual(['resolveBaseUrl()|/shramsafal/job-cards/{…}']);
        expect(scan("const c = '/api/attachments/' + id + '/download';")).toEqual(['|/api/attachments/{…}/download']);
    });

    it('a span is a segment value; a trailing span may be the query; the prefix is never optional; the method counts', () => {
        expect(matches(`/shramsafal/job-cards/${ANY}/start`, '/shramsafal/job-cards/{id:guid}/start')).toBe(true);
        expect(matches(`/shramsafal/farms/${ANY}/job-cards${ANY}`, '/shramsafal/farms/{farmId:guid}/job-cards')).toBe(true);
        expect(matches('/shramsafal/export/verification?farmId=1', '/shramsafal/export/verification')).toBe(true);
        expect(matches(`/job-cards/${ANY}/start`, '/shramsafal/job-cards/{id:guid}/start')).toBe(false);
        expect(matches('/user/auth/me', '/user/auth/me/context')).toBe(false);
        const table: Route[] = [{ method: 'GET', path: '/shramsafal/me/erasure/requests' }, { method: '*', path: '/metrics' }];
        expect(served({ file: 'x', line: 1, path: '/shramsafal/me/erasure/requests', method: 'GET' }, table)).toBe(true);
        expect(served({ file: 'x', line: 1, path: '/shramsafal/me/erasure/requests', method: 'POST' }, table)).toBe(false);
        expect(served({ file: 'x', line: 1, path: '/metrics', method: 'POST' }, table)).toBe(true);
    });
});
