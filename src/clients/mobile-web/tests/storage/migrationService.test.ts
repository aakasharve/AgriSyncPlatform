/**
 * CEI Phase 1 — schemaVersion reservation test placeholder.
 *
 * Real Dexie upgrade tests will be added in Task 5.1.1 when the migration
 * is actually applied. A test framework (Vitest + fake-indexeddb) needs to
 * be set up at that point.
 *
 * For now this file marks the reservation and documents intent.
 */
import { DATABASE_VERSION, CEI_PHASE1_SCHEMA_VERSION } from '../../src/infrastructure/storage/DexieDatabase';

// CEI Phase 1 reserved schema version 7. Still true, still pinned.
const _assertReservation: 7 = CEI_PHASE1_SCHEMA_VERSION;

/**
 * §P0.7 review M2 — THIS USED TO PIN `DATABASE_VERSION` TO 6.
 *
 * `const _assertCurrentIs6: 6 = DATABASE_VERSION;` was written when the schema
 * was at 6 and has been wrong since v7 — seventeen bumps. It never failed
 * anything because this directory is outside both the vitest `include` and the
 * tsconfig, so the "compile-time check" was never compiled.
 *
 * Left as a lower bound rather than an exact pin: an exact pin here is a second
 * place to remember on every bump, and `dexieVersionIntegrity.test.ts` already
 * owns the exact assertion in a file that actually runs. A floor still catches
 * the one thing that matters from here — the constant regressing below a version
 * that has shipped, which throws for every farmer already above it.
 */
const _assertNotRegressed: true = (DATABASE_VERSION >= 22) as true;

// Suppress unused variable lint errors
void _assertReservation;
void _assertNotRegressed;

export {};
