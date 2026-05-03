#!/usr/bin/env node
/**
 * Daily Work Closure (DWC v2) §2.7 — vocabulary parity gate.
 *
 * Asserts the C# `EventVocabulary` registry and the TypeScript
 * `EventSchemas` registry expose the same set of event names. Drift is
 * silent in production (a matview returns zero rows; nobody knows why for
 * weeks) — this script makes drift loud at PR time.
 *
 * The C# side carries 13 entries; the TS side carries the 8 client-emitted
 * events. We split the comparison: every TS event MUST appear in C#
 * (otherwise the backend would 400 the event), and the 5 server-only
 * events (log.created, ai.invocation, api.error, worker.named,
 * admin.farmer_lookup) MUST be present in C# but are expected to be
 * absent from the TS schema.
 *
 * Refs: ADR-2026-05-02_event-vocabulary.md
 *
 * Usage: node scripts/check-event-vocabulary-parity.mjs
 *        Exits 0 on parity, 1 on drift.
 */
import { readFile } from 'node:fs/promises';

const CSHARP_PATH = 'src/apps/Analytics/Analytics.Domain/Vocabulary/EventVocabulary.cs';
const TS_PATH = 'src/clients/mobile-web/src/core/telemetry/eventSchema.ts';

// Server-only events — present in C# vocabulary, absent from the
// client-emitted Zod schema by design (ADR §Decision table).
const SERVER_ONLY = new Set([
    'log.created',
    'ai.invocation',
    'api.error',
    'worker.named',
    'admin.farmer_lookup',
]);

const csharp = await readFile(CSHARP_PATH, 'utf8');
const ts = await readFile(TS_PATH, 'utf8');

// C# pattern: ["closure.started"] = new(...)
const csNames = [...csharp.matchAll(/\["([^"]+)"\]\s*=\s*new/g)]
    .map((m) => m[1])
    .sort();

// TS pattern: 'closure.started': z.object(...)
const tsNames = [...ts.matchAll(/'([a-z_.]+)'\s*:\s*z\.object/g)]
    .map((m) => m[1])
    .sort();

if (csNames.length === 0) {
    console.error(`Could not parse any event names from ${CSHARP_PATH}.`);
    process.exit(1);
}
if (tsNames.length === 0) {
    console.error(`Could not parse any event names from ${TS_PATH}.`);
    process.exit(1);
}

// Every TS event must appear in C#.
const tsMissingInCs = tsNames.filter((n) => !csNames.includes(n));

// Every non-server-only C# event must appear in TS.
const csClientEvents = csNames.filter((n) => !SERVER_ONLY.has(n));
const csMissingInTs = csClientEvents.filter((n) => !tsNames.includes(n));

// Every SERVER_ONLY entry must actually be in C# (catches typos in the
// SERVER_ONLY set above, which would otherwise silently waive a real drift).
const serverOnlyAbsentFromCs = [...SERVER_ONLY].filter((n) => !csNames.includes(n));

let drift = false;

if (tsMissingInCs.length > 0) {
    console.error('Vocabulary parity violation — events present in TS but missing from C#:');
    for (const n of tsMissingInCs) console.error(`  - ${n}`);
    drift = true;
}
if (csMissingInTs.length > 0) {
    console.error('Vocabulary parity violation — events present in C# but missing from TS:');
    for (const n of csMissingInTs) console.error(`  - ${n}`);
    drift = true;
}
if (serverOnlyAbsentFromCs.length > 0) {
    console.error('Vocabulary parity violation — SERVER_ONLY entries declared but absent from C#:');
    for (const n of serverOnlyAbsentFromCs) console.error(`  - ${n}`);
    drift = true;
}

if (drift) {
    console.error('');
    console.error('Resolve drift by adding the missing entry to the appropriate registry,');
    console.error('or by writing a new ADR if a legitimate vocabulary change is intended.');
    console.error('See ADR-2026-05-02_event-vocabulary.md.');
    process.exit(1);
}

const sharedClient = csClientEvents.length;
const serverOnlyCount = SERVER_ONLY.size;
console.log(`OK — vocabulary parity: ${csNames.length} C# entries (${sharedClient} client + ${serverOnlyCount} server-only); ${tsNames.length} TS entries.`);
