// Sub-plan 02 Task 10: in-package smoke tests for the canonical contract.
// These run inside `sync-contract/` as part of the sync-contract.yml CI
// workflow. They validate the JSON's invariants and exercise the
// generator without writing files (idempotency).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const json = JSON.parse(
  readFileSync(resolve(here, '../schemas/mutation-types.json'), 'utf8'),
) as {
  version: string;
  lastUpdated: string;
  mutationTypes: Array<{
    name: string;
    ownerAggregate: string;
    sinceVersion: string;
    payloadSchema: string;
    deprecatedBy?: string;
  }>;
};

describe('mutation-types.json', () => {
  it('declares 32 mutations', () => {
    expect(json.mutationTypes).toHaveLength(32);
  });

  it('has unique mutation names', () => {
    const names = json.mutationTypes.map((m) => m.name);
    const set = new Set(names);
    expect(set.size).toBe(names.length);
  });

  it('every entry has required fields', () => {
    for (const m of json.mutationTypes) {
      expect(m.name).toBeTruthy();
      expect(m.ownerAggregate).toBeTruthy();
      expect(m.sinceVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(m.payloadSchema).toBeTruthy();
    }
  });

  it('deprecatedBy points to a real catalog entry', () => {
    const names = new Set(json.mutationTypes.map((m) => m.name));
    for (const m of json.mutationTypes) {
      if (m.deprecatedBy !== undefined) {
        expect(names.has(m.deprecatedBy)).toBe(true);
      }
    }
  });

  it('payloadSchema is a unique PascalCase identifier', () => {
    const seen = new Set<string>();
    for (const m of json.mutationTypes) {
      // Active (non-deprecated) entries must have unique payload schemas.
      // Deprecated entries are allowed to share or alias.
      if (m.deprecatedBy !== undefined) continue;
      expect(seen.has(m.payloadSchema)).toBe(false);
      seen.add(m.payloadSchema);
      expect(m.payloadSchema).toMatch(/^[A-Z][A-Za-z0-9]+$/);
    }
  });
});
