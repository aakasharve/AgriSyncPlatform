// @vitest-environment node
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, F87) - tests that cannot fail.
 *
 * Two ways a test quietly stops proving anything, both found in this repo:
 *
 *  1. A regex written with CONTROL CHARACTERS. A heredoc ate the backslashes of `\b`, leaving a literal backspace
 *     (U+0008) in the file, so `not.toMatch(/<BS>(4[0-9]...)<BS>/)` matched nothing and could never fail
 *     (DayUnderstandingCard.test.tsx). A control character inside a test file is never intended; a newline or a
 *     tab in a regex is written `\n` / `\t`.
 *  2. A `vi.mock('<path>')` whose target file does not exist. The mock guards nothing: the real module loads and
 *     the test passes for the wrong reason (seven BackgroundSyncWorker / attendance tests mocked a
 *     `SyncPullReconciler` that lives in another folder).
 *
 * This file keeps both from coming back. It reads source only; it needs no browser and no network.
 */
import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..');

const isTestFile = (path: string): boolean =>
    /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/.test(path) || /[\\/]__tests__[\\/][^\\/]+\.(ts|tsx|js|jsx|mjs)$/.test(path);

function collectTestFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) collectTestFiles(full, out);
        else if (isTestFile(full)) out.push(full);
    }
    return out;
}

const TEST_FILES = collectTestFiles(SRC);

// Every test file is read ONCE, all of them concurrently, and the read starts when this module loads (collection time),
// not inside a test: on a loaded full run the ~500 sequential synchronous reads used to be charged to a 15 s test limit.
const CONTENTS: Promise<Map<string, string>> = Promise.all(
    TEST_FILES.map(async (file) => [file, await readFile(file, 'utf8')] as const),
).then((pairs) => new Map(pairs));

/** C0 control characters except tab, line feed and carriage return (which are layout, not content). */
const SUSPECT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** A string-literal module path handed to a vitest mock call. */
const MOCK_CALL = /\bvi\.(?:mock|doMock|unmock|doUnmock)\(\s*(['"`])([^'"`\n]+)\1/g;

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '/index.ts', '/index.tsx', '/index.js'];

const exists = (base: string): boolean =>
    EXTENSIONS.some((ext) => {
        try {
            return statSync(base + ext).isFile();
        } catch {
            return false;
        }
    });

describe('tests that cannot fail (F87)', () => {
    it('finds the test files (the scan itself is not vacuous)', () => {
        expect(TEST_FILES.length).toBeGreaterThan(500);
    });

    it('no test file holds a control character (a regex whose escapes were eaten matches nothing)', async () => {
        const offenders: string[] = [];
        for (const [file, text] of await CONTENTS) {
            const hit = SUSPECT_CONTROL.exec(text);
            if (hit) {
                const line = text.slice(0, hit.index).split('\n').length;
                offenders.push(`${file.slice(SRC.length + 1)}:${line} has U+${hit[0].charCodeAt(0).toString(16).padStart(4, '0')}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('every relative vi.mock / vi.doMock target exists (a mock of a missing file guards nothing)', async () => {
        const missing: string[] = [];
        for (const [file, text] of await CONTENTS) {
            if (file.endsWith('testHygiene.contract.test.ts')) continue;
            for (const match of text.matchAll(MOCK_CALL)) {
                const target = match[2];
                if (!target.startsWith('.')) continue; // a package or an alias: not a file we can resolve here
                if (!exists(resolve(dirname(file), target))) {
                    missing.push(`${file.slice(SRC.length + 1)} mocks '${target}', which does not exist`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it('the mock-target scan can fail: it sees a real mock call and a missing path', () => {
        const sample = "vi.mock('../DefinitelyNotThere', () => ({}));";
        const targets = [...sample.matchAll(MOCK_CALL)].map((m) => m[2]);
        expect(targets).toEqual(['../DefinitelyNotThere']);
        expect(exists(resolve(__dirname, targets[0]))).toBe(false);
        expect(exists(resolve(__dirname, './testHygiene.contract.test'))).toBe(true);
    });

    it('the control-character scan can fail: it flags a backspace and ignores layout', () => {
        expect(SUSPECT_CONTROL.test('/\u0008(4[0-9])\u0008/')).toBe(true);
        expect(SUSPECT_CONTROL.test('line one\r\n\tline two\n')).toBe(false);
    });
});
