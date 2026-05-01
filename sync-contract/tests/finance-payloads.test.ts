// T-IGH-02-PAYLOADS: happy + failing path coverage for Finance
// payloads (correct_cost_entry, allocate_global_expense,
// set_price_config).
import { describe, it, expect } from 'vitest';
import { CorrectCostEntryPayload } from '../schemas/payloads/correct_cost_entry.zod';
import { AllocateGlobalExpensePayload } from '../schemas/payloads/allocate_global_expense.zod';
import { SetPriceConfigPayload } from '../schemas/payloads/set_price_config.zod';

const G1 = '11111111-1111-1111-1111-111111111111';
const G2 = '22222222-2222-2222-2222-222222222222';
const G3 = '33333333-3333-3333-3333-333333333333';

describe('CorrectCostEntryPayload', () => {
  it('accepts a valid payload', () => {
    const r = CorrectCostEntryPayload.safeParse({
      costEntryId: G1,
      correctedAmount: 1500,
      currencyCode: 'INR',
      reason: 'Off by data-entry error',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty reason', () => {
    const r = CorrectCostEntryPayload.safeParse({
      costEntryId: G1,
      correctedAmount: 1500,
      currencyCode: 'INR',
      reason: '',
    });
    expect(r.success).toBe(false);
  });
});

describe('AllocateGlobalExpensePayload', () => {
  it('accepts a payload with multiple allocations', () => {
    const r = AllocateGlobalExpensePayload.safeParse({
      costEntryId: G1,
      allocationBasis: 'BY_ACREAGE',
      allocations: [
        { plotId: G2, amount: 100 },
        { plotId: G3, amount: 200 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects allocations with malformed plotId', () => {
    const r = AllocateGlobalExpensePayload.safeParse({
      costEntryId: G1,
      allocationBasis: 'EQUAL',
      allocations: [{ plotId: 'not-a-guid', amount: 100 }],
    });
    expect(r.success).toBe(false);
  });
});

describe('SetPriceConfigPayload', () => {
  it('accepts a valid payload', () => {
    const r = SetPriceConfigPayload.safeParse({
      itemName: 'Diesel',
      unitPrice: 95.5,
      currencyCode: 'INR',
      effectiveFrom: '2026-04-01',
      version: 1,
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-integer version', () => {
    const r = SetPriceConfigPayload.safeParse({
      itemName: 'Diesel',
      unitPrice: 95.5,
      currencyCode: 'INR',
      effectiveFrom: '2026-04-01',
      version: 1.5,
    });
    expect(r.success).toBe(false);
  });
});
