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
 * IT COMPARES SLOTS, NOT HEAD NUMBERS (review B004). The first version matched
 * `DATABASE_VERSION` against `DATABASE_VERSION`, so a sibling that moved its head
 * to 25 while still carrying a differing `v24.ts` slipped through — the same bug
 * one version later. What collides is a SLOT, so every `vN.ts` present on both
 * sides is compared.
 *
 * "SAME SLOT" IS NOT AUTOMATICALLY A COLLISION. A branch cut from this one
 * inherits the file unchanged; that is normal. A slot fails only when both sides
 * declare it with DIFFERENT contents.
 *
 * A GAP IS ITS OWN DEFECT (review C1). Dexie's schema is the union of the
 * versions the build declares, so a missing version takes every store it
 * introduced with it — deleted off the device, no error, upgrade reports
 * success. Contiguity is checked, and the failure asks for the missing file
 * rather than inviting anyone to delete another.
 *
 * FAILING HONESTLY WHEN IT CANNOT SEE (review B003)
 * -------------------------------------------------
 * The first version printed `SKIPPED` and exited 0 when there were no refs to
 * compare — a gate reporting success having checked nothing, which is the defect
 * it exists to catch. It now EXITS NON-ZERO in that case. `--local-only` is the
 * single exception, because that is an operator saying out loud that only the
 * local half was wanted.
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

/**
 * Comments stripped before any pattern match.
 *
 * DFES's `v23.ts` header contains the literal `db.version(24))` in prose telling
 * the sibling branch to renumber. A first-match regex over raw source reads that
 * sentence as the declaration. A gate that can be satisfied by a comment is not
 * checking the code. (Found by the sibling vitest guard failing on itself.)
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^[ \t]*\/\/.*$/gm, ' ');
}

const problems = [];
const notes = [];

function fail(message) {
    problems.push(message);
}

// ---------------------------------------------------------------------------
// 1. LOCAL COHERENCE
// ---------------------------------------------------------------------------

function parseDeclaredConstant(source) {
    const match = stripComments(source).match(/export const DATABASE_VERSION\s*=\s*(\d+)/);
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
    const dbSource = stripComments(await readFile(DB_FILE, 'utf8'));
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
    // B002 / C1 — A GAP IS THE DEFECT THAT DELETES STORES. Dexie's schema is the
    // union of the versions the build declares, so a missing version takes every
    // store it introduced with it, silently, on upgrade.
    const expectedChain = Array.from({ length: highest }, (_, i) => i + 1);
    const actualChain = files.map(f => f.n);
    if (JSON.stringify(actualChain) !== JSON.stringify(expectedChain)) {
        const missing = expectedChain.filter(n => !actualChain.includes(n));
        fail(
            `The version chain has gaps: missing ${missing.map(n => 'v' + n).join(', ')}. `
            + 'Dexie unions only the versions it is given, so every store introduced at a '
            + 'missing version is dropped from the schema and deleted off the device with no '
            + 'error raised. Add the missing declaration; do NOT lower DATABASE_VERSION to '
            + 'hide it, and do NOT delete the sibling file that still declares it.',
        );
    }

    for (const { name, n } of files) {
        const source = stripComments(await readFile(join(VERSIONS_DIR, name), 'utf8'));

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

/**
 * Repo root, resolved once.
 *
 * Every git call below is pinned to it. `git ls-tree <rev>:<path>` run from a
 * SUBDIRECTORY returns an empty listing and exit code 0 — not an error — and
 * this script runs from `src/clients/mobile-web`. That silent empty made the
 * gate compare "0 version slots" and report OK. Caught only because the note
 * prints the slot count; the guard below now makes it fail outright.
 */
const REPO_ROOT = (() => {
    try {
        return execFileSync('git', ['rev-parse', '--show-toplevel'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return null;
    }
})();

function git(args) {
    return execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        ...(REPO_ROOT ? { cwd: REPO_ROOT } : {}),
    });
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
        .filter(r => !r.endsWith('/HEAD'))
        // Archival refs are not shipping branches, so they cannot collide with one.
        //
        // This check exists to catch two branches that will BOTH reach a handset
        // declaring the same version with different contents. `preserve/*` and
        // `archive/*` are snapshots — a stash given a permanent ref so a laptop
        // failure cannot take it, a branch tagged before deletion. Nothing is ever
        // built or deployed from them, so "renumber the one that ships later" has
        // no meaning for them: neither ships.
        //
        // Added 2026-08-27 after `preserve/stash-2` — a 2026-08-13 stash preserved
        // during the Wave 2 backup sweep, carrying the old dfes v23 — began failing
        // this gate against the merged branch. The collision was real as text and
        // impossible as an event. That is the worst kind of check output: a true
        // statement about an outcome that cannot occur, which teaches the reader to
        // skim the next one. A gate that cries wolf gets ignored, and this gate is
        // too important to be ignored.
        //
        // Deliberately narrow: ONLY these two prefixes. Any ordinary feature branch,
        // however dormant, still counts — dormant branches get revived and shipped.
        .filter(r => !/(^|\/)(?:preserve|archive)\//.test(r));
}

/**
 * Every `vN.ts` at a ref, as `Map<number, contents>`, or `null` when the ref has
 * no versions directory at all.
 */
function listVersionFilesAt(ref) {
    const listing = gitOrNull(['ls-tree', '--name-only', `${ref}:${REL_VERSIONS}`]);
    if (listing === null) return null;

    const files = new Map();
    for (const name of listing.split('\n').map(l => l.trim()).filter(Boolean)) {
        const m = /^v(\d+)\.ts$/.exec(name);
        if (!m) continue;
        const contents = gitOrNull(['show', `${ref}:${REL_VERSIONS}/${name}`]);
        if (contents !== null) files.set(Number(m[1]), contents);
    }
    return files;
}

function checkCrossBranch(ourVersion) {
    // B003 — SKIPPED IS A FAILURE, NOT A NOTE.
    //
    // The first version pushed a note and returned, and the process still exited
    // 0 while printing `SKIPPED`. That is a gate reporting success having checked
    // nothing: the same class of defect it exists to catch. My own report then
    // claimed it "refuses to pass quietly" in one section and admitted the
    // opposite in another.
    //
    // `--local-only` is the ONE skip that does not fail, because that is an
    // operator saying so out loud. Shallow clone, no refs, not a git tree: all
    // exit non-zero.
    if (LOCAL_ONLY) {
        notes.push('cross-branch: SKIPPED by explicit --local-only. NOT a CI-valid run.');
        return;
    }
    if (gitOrNull(['rev-parse', '--git-dir']) === null) {
        fail(
            'cross-branch check could not run: not a git working tree, so nothing was '
            + 'compared. Run it inside a checkout, or pass --local-only to state deliberately '
            + 'that only the local half was wanted.',
        );
        return;
    }

    const refs = listComparableRefs();
    if (refs.length === 0) {
        fail(
            'cross-branch check could not run: no other refs are visible, so nothing was '
            + 'compared.\n'
            + '    In CI this means the checkout is shallow — set actions/checkout '
            + '`with: { fetch-depth: 0 }`.\n'
            + '    Exiting non-zero on purpose: a gate that reports OK having compared '
            + 'nothing is the defect it exists to catch.',
        );
        return;
    }

    // B004 — COMPARE THE SET OF DECLARED VERSION FILES, NOT THE HEAD NUMBER.
    //
    // The first version matched `DATABASE_VERSION` against `DATABASE_VERSION`.
    // If DFES later moves its head to 25 while still carrying a differing
    // `v24.ts`, the two heads no longer match, the loop skips, and the gate
    // reports OK on a genuine v24 slot collision — the same bug one version
    // later. What collides is a SLOT, so every slot has to be compared.
    const ourFiles = listVersionFilesAt('HEAD') ?? new Map();
    if (ourFiles.size === 0) {
        // Same rule as B003: cannot compare, therefore cannot pass.
        fail(
            'cross-branch check could not read this branch’s own version files from git, so '
            + 'every comparison below would be vacuous. Exiting non-zero rather than reporting '
            + 'OK on zero slots.',
        );
        return;
    }
    let compared = 0;

    for (const ref of refs) {
        const theirFiles = listVersionFilesAt(ref);
        if (theirFiles === null) continue; // ref predates the versions directory
        compared += 1;

        for (const [n, ourContent] of ourFiles) {
            const theirContent = theirFiles.get(n);
            if (theirContent === undefined) continue;   // they do not use that slot
            if (theirContent === ourContent) continue;  // same slot, same file — inherited, fine

            fail(
                `Dexie schema slot v${n} COLLIDES with ${ref}: both declare version ${n}, `
                + 'with different contents.\n'
                + '    Dexie runs an upgrade only for versions ABOVE the one on the device, so '
                + 'whichever of these ships SECOND has its upgrade silently skipped on every '
                + 'handset that took the first — and any store only the first declares is '
                + 'deleted with it.\n'
                + '    Renumber the one that ships later. Cheap now; a migration problem the '
                + 'moment either reaches a farmer.',
            );
        }
    }

    // N1 — ACT ON THE DENOMINATOR, DO NOT MERELY PRINT IT.
    //
    // `refs.length === 0` and `ourFiles.size === 0` already fail above, but a
    // third zero slipped between them: refs can EXIST and every one of them can
    // be unreadable — a ref with no versions directory is skipped by `continue`,
    // so `compared` stays 0 while `refs.length` does not. Measured in a scratch
    // repo with one such sibling: `compared 0 of 1 refs`, then `OK`, exit 0.
    //
    // This is the rule from the `0 version slots` defect, half-applied, in the
    // guard that produced the rule. Printing the count makes a defect findable by
    // a human reading output; only acting on it makes it findable by CI, and only
    // the second one is a guard.
    //
    // Unreachable in this repository today — 6 of 52 refs lack the directory and
    // 46 do not — which is exactly why it was worth closing before it was not.
    if (compared === 0) {
        fail(
            `cross-branch check compared nothing: ${refs.length} ref(s) were visible but none `
            + 'had a readable version directory, so no collision could have been detected.\n'
            + '    Exiting non-zero rather than reporting OK on a zero denominator.',
        );
        return;
    }

    notes.push(
        `cross-branch: compared ${compared} of ${refs.length} refs across `
        + `${ourFiles.size} version slots.`,
    );
}

// ---------------------------------------------------------------------------

// A crash here must read as a gate failure, not as a stack trace someone has to
// interpret. Anything unexpected — a missing file, an unreadable ref — is still
// "this gate could not confirm", which is a failure.
let ourVersion = null;
try {
    ourVersion = await checkLocalCoherence();
    if (ourVersion !== null) {
        checkCrossBranch(ourVersion);
    }
} catch (error) {
    fail(`the check itself failed to run: ${error instanceof Error ? error.message : String(error)}`);
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
