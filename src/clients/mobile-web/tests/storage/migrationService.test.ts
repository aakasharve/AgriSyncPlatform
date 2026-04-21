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

// Compile-time check: CEI_PHASE1_SCHEMA_VERSION must equal DATABASE_VERSION + 1
const _assertReservation: 7 = CEI_PHASE1_SCHEMA_VERSION;
const _assertCurrentIs6: 6 = DATABASE_VERSION;

// Suppress unused variable lint errors
void _assertReservation;
void _assertCurrentIs6;

export {};
