// G1 — CONTRACT-PARITY GATE.
//
// The server's payload allow-list is HAND-WRITTEN, once per mutation, as a
// `PayloadHasOnly(payload, "a", "b", ...)` call inside
// `PushSyncBatchHandler`. The canonical payload shape is a Zod object under
// `sync-contract/schemas/payloads/`. Until this file existed, nothing
// compiled the two against each other: a key could be added to one side and
// silently refused (or silently accepted) by the other, and the only thing
// standing between a farmer's record and a whole-mutation rejection was a
// prose comment in the producer. That asymmetry is the mechanism behind the
// money-correction defect, and it was unguarded across every mutation.
//
// This test needs no database, no server and no network. It reads the .cs
// file as text, reads the Zod objects as values, and asserts set equality of
// the key names. It fails the moment either side drifts.
//
// Anything asserted here is measured from the repo, not remembered:
//   - the allow-list count is asserted, so a parser that silently reads 3 of
//     13 sites cannot report green;
//   - the covered mutation names are asserted, so a mutation whose allow-list
//     disappears is a failure, not a gap.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as payloads from '../schemas/payloads';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const HANDLER_PATH = resolve(
    repoRoot,
    'src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs',
);

// Measured 2026-08-15 against PushSyncBatchHandler.cs: thirteen call sites
// (lines 470, 502, 549, 603, 917, 967, 1030, 1093, 1166, 1215, 1267, 1324,
// 1379) plus the helper's own declaration at 1476, which is NOT a call site.
// If a mutation gains or loses an allow-list this number must move
// deliberately, in the same commit, with the mutation named below.
const EXPECTED_ALLOWLIST_COUNT = 13;

// The mutations that carry a server allow-list today. A mutation dispatched
// to a handler with no `PayloadHasOnly` guard (jobcard.*, compliance.*) is
// not in scope for parity — it has no server-side key contract to compare
// against — and a mutation that silently drops out of this list is a
// regression in server-side strictness, so the list is asserted exactly.
const EXPECTED_GUARDED_MUTATIONS = [
    'create_farm',
    'create_plot',
    'create_crop_cycle',
    'create_daily_log',
    'add_log_task',
    'verify_log',
    'add_cost_entry',
    'allocate_global_expense',
    'correct_cost_entry',
    'set_price_config',
    'create_attachment',
    'testinstance.collected',
    'testinstance.reported',
].sort();

interface CatalogEntry {
    name: string;
    payloadSchema: string;
}

const catalog = (
    JSON.parse(
        readFileSync(resolve(here, '../schemas/mutation-types.json'), 'utf8'),
    ) as { mutationTypes: CatalogEntry[] }
).mutationTypes;

const source = readFileSync(HANDLER_PATH, 'utf8');

// ── Parse 1: handler method → allow-list keys ─────────────────────────
// Walks the file line by line, remembering the most recent handler
// declaration, so each `PayloadHasOnly` call is attributed to the method it
// guards. `PayloadHasOnly(JsonElement payload, ...)` — the helper's own
// declaration — does not match, because a call site passes the bare
// identifier `payload`.
const METHOD_DECL =
    /^\s*private\s+(?:static\s+)?async\s+Task<MutationExecutionOutcome>\s+(Handle\w+Async)\s*\(/;
const ALLOWLIST_CALL = /PayloadHasOnly\(\s*payload\s*,\s*([^)]*)\)/;

const allowlistByMethod = new Map<string, string[]>();
let currentMethod: string | null = null;

for (const line of source.split(/\r?\n/)) {
    const decl = METHOD_DECL.exec(line);
    if (decl) {
        currentMethod = decl[1];
        continue;
    }
    const call = ALLOWLIST_CALL.exec(line);
    if (!call) continue;
    if (currentMethod === null) {
        throw new Error(
            `PayloadHasOnly call found outside any handler method: ${line.trim()}`,
        );
    }
    const keys = [...call[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    allowlistByMethod.set(currentMethod, keys);
}

// ── Parse 2: mutation type → handler method (the dispatch switch) ─────
const DISPATCH =
    /case\s+"([^"]+)"\s*:\s*(?:\r?\n\s*\/\/[^\r\n]*)*\s*return\s+await\s+(Handle\w+Async)\s*\(/g;

const methodByMutation = new Map<string, string>();
for (const m of source.matchAll(DISPATCH)) {
    methodByMutation.set(m[1], m[2]);
}

const mutationByMethod = new Map<string, string>();
for (const [mutation, method] of methodByMutation) {
    mutationByMethod.set(method, mutation);
}

const schemaByMutation = new Map(
    catalog.map((entry) => [entry.name, `${entry.payloadSchema}Payload`]),
);

const zodExports = payloads as unknown as Record<
    string,
    { shape?: Record<string, unknown> } | undefined
>;

function zodKeysFor(schemaKey: string): string[] {
    const schema = zodExports[schemaKey];
    if (!schema || typeof schema.shape !== 'object' || schema.shape === null) {
        throw new Error(
            `No Zod object exported as '${schemaKey}' from sync-contract/schemas/payloads`,
        );
    }
    return Object.keys(schema.shape);
}

// ── The gate ──────────────────────────────────────────────────────────

describe('G1 contract parity — server allow-list vs canonical Zod shape', () => {
    it(`parses exactly ${EXPECTED_ALLOWLIST_COUNT} PayloadHasOnly allow-lists`, () => {
        // A gate that silently parses 3 of 13 and passes is how a green check
        // becomes meaningless. Assert the count before asserting anything else.
        expect(
            allowlistByMethod.size,
            `Parsed ${allowlistByMethod.size} allow-list(s) from ${HANDLER_PATH}: ` +
                `[${[...allowlistByMethod.keys()].join(', ')}]`,
        ).toBe(EXPECTED_ALLOWLIST_COUNT);
    });

    it('resolves every allow-list to a dispatched mutation type', () => {
        const unresolved = [...allowlistByMethod.keys()].filter(
            (method) => !mutationByMethod.has(method),
        );
        expect(
            unresolved,
            'Handler methods carrying an allow-list but reachable from no ' +
                '`case "<mutation>":` in ExecuteMutationAsync',
        ).toEqual([]);
    });

    it('guards exactly the expected set of mutations', () => {
        const guarded = [...allowlistByMethod.keys()]
            .map((method) => mutationByMethod.get(method) as string)
            .sort();
        expect(guarded).toEqual(EXPECTED_GUARDED_MUTATIONS);
    });

    it('maps every guarded mutation onto an exported Zod object', () => {
        for (const mutation of EXPECTED_GUARDED_MUTATIONS) {
            const schemaKey = schemaByMutation.get(mutation);
            expect(schemaKey, `no catalog entry for '${mutation}'`).toBeTruthy();
            expect(zodKeysFor(schemaKey as string).length).toBeGreaterThan(0);
        }
    });

    // One case per mutation, so a failure names the mutation AND the exact
    // keys that drifted, in which direction.
    for (const mutation of EXPECTED_GUARDED_MUTATIONS) {
        it(`${mutation}: Zod key set equals the server allow-list`, () => {
            const method = methodByMutation.get(mutation);
            expect(method, `'${mutation}' has no dispatch case`).toBeTruthy();

            const serverKeys = allowlistByMethod.get(method as string);
            expect(
                serverKeys,
                `'${mutation}' → ${method} has no PayloadHasOnly allow-list`,
            ).toBeTruthy();

            const schemaKey = schemaByMutation.get(mutation) as string;
            const zodKeys = zodKeysFor(schemaKey);

            const serverSet = new Set(serverKeys as string[]);
            const zodSet = new Set(zodKeys);

            const permittedByClientRefusedByServer = zodKeys
                .filter((k) => !serverSet.has(k))
                .sort();
            const requiredByServerAbsentFromClient = (serverKeys as string[])
                .filter((k) => !zodSet.has(k))
                .sort();

            expect({
                mutation,
                schema: schemaKey,
                permittedByClientRefusedByServer,
                requiredByServerAbsentFromClient,
            }).toEqual({
                mutation,
                schema: schemaKey,
                permittedByClientRefusedByServer: [],
                requiredByServerAbsentFromClient: [],
            });
        });
    }
});
