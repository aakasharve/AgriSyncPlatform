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
  // 34 -> 36 on 2026-10-31 (lane OF-S): move_daily_log + correct_labour_assignment.
  // 36 -> 37 on 2026-11-01 (lane PRV, founder D-26): set_record_audience.
  // 37 -> 38 on 2026-11-06 (lane RATE-1 part A, founder D-72): set_farm_rate.
  // 38 -> 39 on 2026-11-07 (lane BILL-1, founder D-12): approve_cost_entry.
  // 39 -> 40 on 2026-11-08 (lane IT2, founders D-92 / D-95): assert_input_identity.
  // 40 -> 45 on 2026-11-08 (lane L8c-1, founder D-24c): plannedwork.{create,edit,seen,accept,cancel}; 1.9.0 -> 1.10.0.
  // 45 -> 47 on 2026-11-08 (lane L8c-3, founder D-24d): plannedwork.complete + plannedwork.reopen; 1.10.0 -> 1.11.0.
  // 47 -> 47 on 2026-11-09 (lane L8b-3, founder D-74): abandon_schedule gains an optional subscriptionId; 1.11.0 -> 1.12.0.
  // 47 -> 48 on 2026-11-09 (lane SCH-OWN, founder D-74 / D-82 = 3): schedule.create ("start blank"); schedule.clone and schedule.edit are WIRED
  // and gain their fields (no new entry); 1.12.0 -> 1.13.0.
  // 48 -> 48 on 2026-11-10 (lane SCH-OWN-c, founder D-137 Q10 = 1): schedule.create and schedule.edit gain the four optional made-for tags
  // (variety / soilType / region / climate, list codes from schedule-made-for.json); no new entry; 1.13.0 -> 1.14.0 (additive).
  // 48 -> 48 on 2026-11-11 (lane REM-1, founder D-78 / D-84 = 1): no new mutation (the reminder settings are REST only, never queued: R21); the pull's
  // `plannedWork` rows gain the additive fields createdByName, category, mayPlayVoice, wordsWithheld, makerAlwaysShown, fromChosenPeopleRecord; 1.14.0 -> 1.15.0.
  // 48 -> 49 on 2026-11-13 (lane CMP-D3, founder D-68 round 2): logreason.set - a reason kept on an existing record of work; 1.15.0 -> 1.16.0.
  it('declares 49 mutations', () => {
    expect(json.mutationTypes).toHaveLength(49);
  });

  it('is contract version 1.16.0 and names logreason.set', () => {
    expect(json.version).toBe('1.16.0');
    expect(json.mutationTypes.map((m) => m.name)).toContain('logreason.set');
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
