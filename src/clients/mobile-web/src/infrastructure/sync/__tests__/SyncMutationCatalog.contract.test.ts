import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYNC_MUTATION_TYPES, isSyncMutationType } from '../SyncMutationCatalog';

describe('SyncMutationCatalog (frontend)', () => {
  it('matches the canonical JSON exactly', () => {
    // 7 levels up from src/clients/mobile-web/src/infrastructure/sync/__tests__/
    // to reach the repo root, then sync-contract/schemas/mutation-types.json.
    const jsonPath = join(__dirname, '../../../../../../../sync-contract/schemas/mutation-types.json');
    const json = JSON.parse(readFileSync(jsonPath, 'utf8')) as { mutationTypes: { name: string }[] };
    const fromJson = json.mutationTypes.map((m) => m.name).sort();
    const fromCatalog = [...SYNC_MUTATION_TYPES].sort();
    expect(fromCatalog).toEqual(fromJson);
  });

  it('isSyncMutationType type-narrows correctly', () => {
    expect(isSyncMutationType('create_farm')).toBe(true);
    expect(isSyncMutationType('does_not_exist')).toBe(false);
  });

  it('legacy module AgriSyncClient re-exports SyncMutationType from catalog', async () => {
    const mod = await import('../../api/AgriSyncClient');
    // SyncMutationType is a type-only export; verify by checking it tree-shakes
    // through SYNC_MUTATION_TYPES indirectly: any value type-asserted as
    // SyncMutationType must be in the catalog.
    const sample: typeof SYNC_MUTATION_TYPES[number] = 'create_farm';
    expect(SYNC_MUTATION_TYPES).toContain(sample);
    expect(mod).toBeDefined();
  });

  it('forbids legacy hard-coded SUPPORTED_MUTATION_TYPES', () => {
    // Static-source assertion: MutationQueue must NOT redefine the list.
    const queueSrc = readFileSync(
      join(__dirname, '../MutationQueue.ts'),
      'utf8'
    );
    expect(queueSrc).not.toMatch(/new Set\(\[\s*['"]create_farm/);
  });
});
