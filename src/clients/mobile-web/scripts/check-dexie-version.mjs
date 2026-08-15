#!/usr/bin/env node
/**
 * DEXIE SCHEMA VERSION GATE — the check that would have caught the v23 collision.
 *
 * WHAT HAPPENED, AND WHY NOTHING SAW IT
 * -------------------------------------
 * `feat/server-authoritative-architecture` and `feat/dfes-companion` both
 * declared `DATABASE_VERSION = 23`, for two different schemas. Each branch was
 * internally consistent, every test on each was green, and no gate in this
 * repository compares two branches — so the collision was invisible to CI and
 * visible only to a human who happened to open both files.
 *
 * The consequence was not a merge conflict. Dexie runs an upgrade only for
 * versions ABOVE the one recorded on the device, so the branch that shipped
 * SECOND would have had its upgrade silently skipped on every handset that took
 * the first — in this case leaving §P0.4's transcript strip un-run and the
 * farmer's raw speech sitting in unencrypted IndexedDB, under a fix that looked
 * shipped.
 *
 * TWO CHECKS, AND THEY ANSWER DIFFERENT QUESTIONS
 * -----------------------------------------------
 *   1. LOCAL COHERENCE — the constant, the file names and the numbers each
 *      `applyVN` actually declares all agree, and `DexieDatabase.ts` applies
 *      every one of them. This catches a half-finished renumber, which is
 *      exactly the failure mode of fixing a collision by hand.
 *
 *      This one is ALSO a vitest case (`dexieVersionIntegrity.test.ts`), so it
 *      gates on every run of the existing suite rather than waiting for someone
 *      to wire a workflow step.
 *
 *   2. CROSS-BRANCH COLLISION — no other ref declares this same version number
 *      with a different schema behind it. This is the one that needed to exist
 *      and did not.
 *
 * "SAME NUMBER" IS NOT AUTOMATICALLY A COLLISION. A branch cut from this one
 * inherits both the number and the file, unchanged; that is normal. So a ref
 * only fails when it declares the same number AND its `versions/vN.ts` differs
 * from ours — different schema, same slot, which is the actual hazard.
 *
 * FAILING HONESTLY WHEN IT CANNOT SEE
 * -----------------------------------
 * In a shallow clone there are no other refs to compare against. This does NOT
 * pass quietly in that case: it prints that the cross-branch half was SKIPPED
 * and why. A gate that reports success when it checked nothing is the defect
 * this file exists to remove, wearing a different hat.
 *
 * Run:  node scripts/check-dexie-version.mjs
 *       node scripts/check-dexie-version.mjs --local-only
 */
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STORAGE_DIR = fileURLToPath(new URL('../src/infrastructure/storage', import.meta.url));
const VERSIONS_DIR = join(STORAGE_DIR, 'dexie', 'versions');
const DB_FILE = join(STORAGE_DIR, 'DexieDatabase.ts');

/** Repo-relative paths, for `git show <ref>:<path>`. */
const REL_DB_FILE = 'src/clients/mobile-web/src/infrastructure/storage/DexieDatabase.ts';
const REL_VERSIONS = 'src/clients/mobile-web/src/infrastructure/storage/dexie/versions';

const LOCAL_ONLY = process.argv.includes('--local-only');

const problems = [];
const notes = [];

function fail(message) {
    problems.push(message);
}

// ---------------------------------------------------------------------------
// 1. LOCAL COHERENCE
// ---------------------------------------------------------------------------

function parseDeclaredConstant(source) {
    const match = source.match(/export const DATABASE_VERSION\s*=\s*(\d+)/);
    return match ? Number(match[1]) : null;
}

async function readVersionFiles() {
    const entries = await readdir(VERSIONS_DIR);
    const files = entries
        .map(name => ({ name, match: /^v(\d+)\.ts$/.exec(name) }))
        .filter(e => e.match !== null)
        .map(e => ({ name: e.name, n: Number(e.match[1]) }))
        .sort((a, b) => a.n - b.n);
    return files;
}

async function checkLocalCoherence() {
    const dbSource = await readFile(DB_FILE, 'utf8');
    const declared = parseDeclaredConstant(dbSource);

    if (declared === null) {
        fail('DexieDatabase.ts does not export a numeric DATABASE_VERSION.');
        return null;
    }

    const files = await readVersionFiles();
    if (files.length === 0) {
        fail('No dexie/versions/vN.ts files found.');
        return declared;
    }

    const highest = files[files.length - 1].n;
    if (declared !== highest) {
        fail(
            `DATABASE_VERSION is ${declared} but the highest version file is v${highest}.ts. ` +
            'These must agree: the constant is what Dexie compares against the number on the ' +
            "device, and a mismatch means either an upgrade that never runs or one that runs twice.",
        );
    }

    // Every file's NAME, its exported function NAME and the number it actually
    // declares must be the same number. A hand-renumber that misses one of the
    // three produces a file that looks moved and behaves as if it never was.
    for (const { name, n } of files) {
        const source = await readFile(join(VERSIONS_DIR, name), 'utf8');

        if (!new RegExp(`export function applyV${n}\\s*\\(`).test(source)) {
            fail(`${name} does not export applyV${n} — the file name and the function disagree.`);
        }
        const declaredInFile = source.match(/db\.version\(\s*(\d+)\s*\)/);
        if (!declaredInFile) {
            fail(`${name} never calls db.version(...).`);
        } else if (Number(declaredInFile[1]) !== n) {
            fail(
                `${name} calls db.version(${declaredInFile[1]}) — the file name says ${n}. ` +
                'Dexie reads the call, not the file name.',
            );
        }

        if (!new RegExp(`applyV${n}\\s*\\(this\\)`).test(dbSource)) {
            fail(`DexieDatabase.ts never calls applyV${n}(this) — v${n} would not be applied at all.`);
        }
        if (!new RegExp(`from '\\./dexie/versions/v${n}'`).test(dbSource)) {
            fail(`DexieDatabase.ts does not import from './dexie/versions/v${n}'.`);
        }
    }

    notes.push(`local: DATABASE_VERSION=${declared}, ${files.length} version files, highest v${highest}.`);
    return declared;
}

// ---------------------------------------------------------------------------
// 2. CROSS-BRANCH COLLISION
// ---------------------------------------------------------------------------

function git(args) {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function gitOrNull(args) {
    try {
        return git(args);
    } catch {
        return null;
    }
}

function listComparableRefs() {
    const raw = gitOrNull(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
    if (raw === null) return [];

    const head = (gitOrNull(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').trim();
    return raw.split('\n')
        .map(r => r.trim())
        .filter(Boolean)
        // HEAD's own ref, and the symbolic origin/HEAD pointer, are not other branches.
        .filter(r => !r.endsWith(`/${head}`) && r !== `refs/heads/${head}`)
        .filter(r => !r.endsWith('/HEAD'));
}

function checkCrossBranch(ourVersion) {
    if (LOCAL_ONLY) {
        notes.push('cross-branch: SKIPPED (--local-only).');
        return;
    }
    if (gitOrNull(['rev-parse', '--git-dir']) === null) {
        notes.push('cross-branch: SKIPPED — not a git working tree.');
        return;
    }

    const refs = listComparableRefs();
    if (refs.length === 0) {
        // Loud on purpose. A shallow checkout can see nothing, and a gate that
        // reports success having checked nothing is the same class of defect
        // this file exists to catch.
        notes.push(
            'cross-branch: SKIPPED — no other refs visible. In CI this means the checkout is ' +
            'shallow; use actions/checkout with fetch-depth: 0 or this half of the gate is inert.',
        );
        return;
    }

    const ourVersionFile = gitOrNull(['show', `HEAD:${REL_VERSIONS}/v${ourVersion}.ts`]);
    let compared = 0;

    for (const ref of refs) {
        const theirDb = gitOrNull(['show', `${ref}:${REL_DB_FILE}`]);
        if (theirDb === null) continue; // ref predates the file, or has no client
        const theirs = parseDeclaredConstant(theirDb);
        if (theirs === null) continue;
        compared += 1;
        if (theirs !== ourVersion) continue;

        // Same number. That is only a collision if the schema behind it differs —
        // a branch cut from this one inherits both, which is normal.
        const theirVersionFile = gitOrNull(['show', `${ref}:${REL_VERSIONS}/v${ourVersion}.ts`]);
        if (theirVersionFile !== null && ourVersionFile !== null && theirVersionFile === ourVersionFile) {
            continue;
        }

        fail(
            `DATABASE_VERSION ${ourVersion} COLLIDES with ${ref}, which declares the same number ` +
            'for a different schema.\n' +
            '    Dexie runs an upgrade only for versions ABOVE the one on the device, so whichever ' +
            'of these ships SECOND will have its upgrade silently skipped on every handset that ' +
            'took the first.\n' +
            '    Renumber the one that ships later. This is cheap now and becomes a migration ' +
            'problem the moment either reaches a farmer.',
        );
    }

    notes.push(`cross-branch: compared ${compared} of ${refs.length} refs.`);
}

// ---------------------------------------------------------------------------

const ourVersion = await checkLocalCoherence();
if (ourVersion !== null) {
    checkCrossBranch(ourVersion);
}

for (const note of notes) {
    console.log(`[dexie-version] ${note}`);
}

if (problems.length > 0) {
    console.error('\n[dexie-version] FAILED:\n');
    for (const p of problems) {
        console.error(`  - ${p}\n`);
    }
    process.exit(1);
}

console.log('[dexie-version] OK');
