/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1 (F100; review F-1).
 *
 * Every REST path the phone calls must be a route the server has. The phone called 18 that it did not (a missing
 * `/shramsafal` prefix, or a path that never existed): each screen answered 404, showed its failure, and nothing noticed.
 *
 * HOW: the phone's own source is read with the TypeScript compiler (never by hand-kept lists). A string is a REST path
 * when it is
 *   1. a template that starts with an API base (`${resolveBaseUrl()}/…`, `${base}/…`, `${baseUrl}/…`, or a helper in the
 *      same file that is itself such a base plus literal text, like `apiBase()` = `${resolveBaseUrl()}/shramsafal`);
 *   2. the first argument of an axios call on the API transport (`t.http.get('/…')`, `authHttp.post`, `axiosClient.get`)
 *      or of `apiFetch('/…')`; or
 *   3. any literal that starts with one of the server's own top-level segments (`/shramsafal/…`, `/user/…`, …).
 * Each path (`${…}` = any value, the query string dropped) must match a route in the server's route table.
 *
 * THE TABLE: `sync-contract/routes/server-rest-routes.txt`, every route the production host serves. It is kept current by
 * the server test `ServerRouteTableTests` (src/tests/ShramSafal.Sync.IntegrationTests/Contract), which builds the host the
 * way Program.cs maps it and FAILS when the file differs (regenerate with AGRISYNC_WRITE_ROUTE_TABLE=1). A server change
 * that moves or removes a route therefore fails there until the file is regenerated, and this test then checks the phone
 * against the new table.
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

/** "METHOD /path" lines of the server's route table. */
function serverRoutes(): string[] {
    return readFileSync(TABLE_PATH, 'utf8')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#'))
        .map(l => l.slice(l.indexOf(' ') + 1));
}

/**
 * A path the phone still calls that the server does not have, kept on purpose with its reason, keyed "file path". An
 * entry here must still be a mismatch (the test fails when it is fixed, so the entry is removed with the fix).
 */
const CARRIED: Record<string, string> = {
    // Review row 17: the crop-schedule-template picker, which its own comment says is never shown. Carried to lane L8b.
    'infrastructure/api/resources/ScheduleResource.ts /shramsafal/reference-data/crop-schedule-templates':
        'row 17: schedule-template picker, never shown (lane L8b)',
};

/**
 * Text that looks like a path but is never requested, keyed "file path", with its reason. Kept as short as possible: an
 * entry silences only that one text in that one file.
 */
const NOT_A_CALL: Record<string, string> = {
    // Made-up rows the admin ops preview draws (an error row's endpoint, as text); nothing is requested from it.
    'features/admin/ops/AdminOpsPreview.tsx /shramsafal/sync/push': 'preview data, never requested',
};

/** A `${…}` span inside a phone path. */
const ANY = '\u0000';

/** The API base expressions (the API's origin, nothing more). */
const ORIGIN_BASES = new Set(['resolveBaseUrl()', 'resolveApiBaseUrl()', 'baseUrl', 'base', 'API_BASE_URL', 'apiBaseUrl']);
const AXIOS_RECEIVER = /(^|\.)(http|authHttp|axiosClient)$/;
const AXIOS_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete']);

interface Found { file: string; path: string; line: number }

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

/** The template's text with every `${…}` span as ANY; `skipFirstSpan` drops the head and the first span (the base). */
function templateText(node: ts.TemplateExpression, skipFirstSpan: boolean): string {
    let text = skipFirstSpan ? '' : node.head.text;
    node.templateSpans.forEach((span, i) => {
        if (!(skipFirstSpan && i === 0)) text += ANY;
        text += span.literal.text;
    });
    return text;
}

function literalText(node: ts.Node): string | null {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) return templateText(node, false);
    return null;
}

/**
 * `name` → the literal path it adds to the API origin, for `const name = \`${origin}/x\`` or `() => \`${origin}/x\``, when
 * `name` is itself used to start another path in the file (`${name}/…` or `${name()}/…`). A plain `const url = …` is a
 * path, not a base.
 */
function fileBases(sf: ts.SourceFile): Map<string, string> {
    const bare = (text: string) => (text.endsWith('()') ? text.slice(0, -2) : text);
    const startsPaths = new Set<string>();
    sf.forEachChild(function collect(node): void {
        if (ts.isTemplateExpression(node) && node.head.text === '' && node.templateSpans[0].literal.text.startsWith('/')) {
            startsPaths.add(bare(node.templateSpans[0].expression.getText(sf)));
        }
        node.forEachChild(collect);
    });
    const bases = new Map<string, string>();
    const baseOf = (expr: ts.Expression): string | null => {
        const text = expr.getText(sf);
        if (ORIGIN_BASES.has(text)) return '';
        return bases.get(bare(text)) ?? null;
    };
    let grew = true;
    while (grew) {
        grew = false;
        sf.forEachChild(function visit(node): void {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
                && startsPaths.has(node.name.text) && !bases.has(node.name.text)) {
                let body: ts.Node = node.initializer;
                if (ts.isArrowFunction(body) && !ts.isBlock(body.body)) body = body.body;
                if (ts.isTemplateExpression(body) && body.head.text === '' && body.templateSpans.length === 1) {
                    const prefix = baseOf(body.templateSpans[0].expression);
                    if (prefix !== null && body.templateSpans[0].literal.text.startsWith('/')) {
                        bases.set(node.name.text, prefix + body.templateSpans[0].literal.text);
                        grew = true;
                    }
                }
            }
            node.forEachChild(visit);
        });
    }
    return bases;
}

function phonePaths(serverRoots: Set<string>): Found[] {
    const found: Found[] = [];
    for (const file of sourceFiles(SRC)) {
        const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
            file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const bases = fileBases(sf);
        const rel = relative(SRC, file).split(sep).join('/');
        const add = (node: ts.Node, path: string) =>
            found.push({ file: rel, path, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });

        const visit = (node: ts.Node): void => {
            // 1. A template that starts with an API base.
            if (ts.isTemplateExpression(node) && node.head.text === '') {
                const first = node.templateSpans[0].expression.getText(sf);
                const bare = first.endsWith('()') ? first.slice(0, -2) : first;
                const prefix = ORIGIN_BASES.has(first) ? '' : bases.get(bare);
                const rest = templateText(node, true);
                // The declaration of a base itself (const apiBase = () => `${resolveBaseUrl()}/shramsafal`) is not a call.
                const declared = ts.isVariableDeclaration(node.parent) ? node.parent
                    : ts.isArrowFunction(node.parent) && ts.isVariableDeclaration(node.parent.parent) ? node.parent.parent
                        : null;
                const isDeclarationOfBase = declared !== null && ts.isIdentifier(declared.name) && bases.has(declared.name.text);
                if (prefix !== undefined && rest.startsWith('/') && !isDeclarationOfBase) {
                    add(node, prefix + rest);
                    return;
                }
            }
            // 2. The first argument of an axios call on the API transport, or of apiFetch.
            if (ts.isCallExpression(node) && node.arguments.length > 0) {
                const callee = node.expression;
                const isAxios = ts.isPropertyAccessExpression(callee) && AXIOS_VERBS.has(callee.name.text)
                    && AXIOS_RECEIVER.test(callee.expression.getText(sf));
                const isApiFetch = ts.isIdentifier(callee) && callee.text === 'apiFetch';
                const text = (isAxios || isApiFetch) ? literalText(node.arguments[0]) : null;
                if (text !== null && text.startsWith('/')) {
                    add(node.arguments[0], text);
                    node.arguments.slice(1).forEach(visit);
                    return;
                }
            }
            // 3. Any literal that starts with one of the server's own top-level segments.
            if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
                const text = literalText(node);
                const root = text?.match(/^\/([a-z-]+)\//)?.[1];
                if (text && root && serverRoots.has(root)) {
                    add(node, text);
                    return;
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

const show = (path: string) => pathOnly(path).split(ANY).join('{…}');

describe('lane F99 fix pass 1 (F100): every phone REST path is a route the server has', () => {
    const routes = serverRoutes();
    const roots = new Set(routes.map(r => r.split('/')[1]).filter(Boolean));
    const found = phonePaths(roots);
    // A path made only of spans (`${base}${path}`, a generic helper) names nothing on its own; it is not checkable here.
    const checkable = found
        .filter(f => /^\/[a-z]/i.test(pathOnly(f.path)))
        .filter(f => !(`${f.file} ${show(f.path)}` in NOT_A_CALL));

    it('reads a real table and finds the phone\'s calls (or it proves nothing)', () => {
        expect(routes.length).toBeGreaterThan(150);
        expect(roots.has('shramsafal')).toBe(true);
        expect(checkable.length).toBeGreaterThan(60);
        // Known calls, one per way of building a path, are found:
        const shown = checkable.map(f => `${f.file} ${show(f.path)}`);
        expect(shown).toContain('features/work/data/jobCardsClient.ts /shramsafal/job-cards/{…}/start');
        expect(shown).toContain('infrastructure/api/resources/AuthResource.ts /user/auth/me/context');
        expect(shown.some(s => s.startsWith('infrastructure/api/resources/SyncResource.ts /sync/'))).toBe(true);
    });

    it('no phone path is missing from the server', () => {
        const missing = checkable
            .filter(f => !routes.some(r => matches(f.path, r)))
            .map(f => `${f.file}:${f.line} ${show(f.path)}`);
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

describe('the path matcher', () => {
    it('a span is a segment value; a trailing span may be the query; the prefix is never optional', () => {
        expect(matches(`/shramsafal/job-cards/${ANY}/start`, '/shramsafal/job-cards/{id:guid}/start')).toBe(true);
        expect(matches(`/shramsafal/farms/${ANY}/job-cards${ANY}`, '/shramsafal/farms/{farmId:guid}/job-cards')).toBe(true);
        expect(matches('/shramsafal/export/verification?farmId=1', '/shramsafal/export/verification')).toBe(true);
        expect(matches(`/job-cards/${ANY}/start`, '/shramsafal/job-cards/{id:guid}/start')).toBe(false);
        expect(matches('/user/auth/me', '/user/auth/me/context')).toBe(false);
        expect(matches(`/shramsafal/job-cards/${ANY}/starts`, '/shramsafal/job-cards/{id:guid}/start')).toBe(false);
    });
});
