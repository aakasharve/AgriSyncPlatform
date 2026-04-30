import { describe, it, expect } from 'vitest';
import { validatePayload } from '../PayloadValidator';

describe('PayloadValidator', () => {
  it('passes valid create_daily_log payloads', () => {
    const result = validatePayload('create_daily_log', {
      clientRequestId: 'req-1',
      logId: '11111111-1111-1111-1111-111111111111',
      farmId: '22222222-2222-2222-2222-222222222222',
      plotIds: ['33333333-3333-3333-3333-333333333333'],
      capturedAt: '2026-04-27T10:00:00Z',
      inputMode: 'voice',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects payloads missing required fields', () => {
    const result = validatePayload('create_daily_log', { logId: 'not-a-guid' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('returns ok for mutations with z.unknown() scaffold (no false positives)', () => {
    // jobcard.create has a z.unknown() scaffold today (T-IGH-02-PAYLOADS).
    // Validator must not block until the schema is hardened.
    const result = validatePayload('jobcard.create', { anything: true });
    expect(result.ok).toBe(true);
  });

  it('rejects unknown mutation type', () => {
    const result = validatePayload('does_not_exist' as never, {});
    expect(result.ok).toBe(false);
  });
});
