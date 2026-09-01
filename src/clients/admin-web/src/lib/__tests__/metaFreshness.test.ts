import { describe, expect, it } from 'vitest';

import { metaRefreshedAt } from '../api';

/**
 * The server sends `lastRefreshedUtc`.
 *
 * `AdminMetaDto` is `(Source, Window, LastRefreshedUtc, TtlSeconds)` —
 * `ShramSafal.Application/Contracts/Dtos/AdminResponseDto.cs:11-16` — and its own
 * doc-comment says the freshness chip reads `LastRefreshedUtc`.
 *
 * Until 2026-09-01 `lib/api.ts` declared `lastRefreshed` REQUIRED and
 * `lastRefreshedUtc` optional, exactly inverted. Against the real server
 * `meta.lastRefreshed` was therefore `undefined` on EVERY admin screen, and every
 * freshness chip fell through to its `|| 'now'` fallback — a fabricated freshness
 * age, on every screen at once.
 *
 * It survived review because the fixtures stubbed the key the TYPE named rather
 * than the key the SERVER sends. Every test injected the seam, so the shipping
 * shape was never exercised. These tests exist to make that impossible twice.
 */
describe('metaRefreshedAt — the key the server actually sends', () => {
  const stamp = '2026-09-01T04:00:00.000Z';

  it("reads lastRefreshedUtc, which is what AdminMetaDto serialises", () => {
    expect(metaRefreshedAt({ lastRefreshedUtc: stamp })).toBe(stamp);
  });

  it('prefers lastRefreshedUtc when both spellings somehow arrive', () => {
    expect(
      metaRefreshedAt({ lastRefreshedUtc: stamp, lastRefreshed: '1999-01-01T00:00:00.000Z' }),
    ).toBe(stamp);
  });

  it('still reads the legacy spelling, so an old endpoint is not silently ageless', () => {
    expect(metaRefreshedAt({ lastRefreshed: stamp })).toBe(stamp);
  });

  it.each([
    ['no meta at all', undefined],
    ['a meta carrying neither spelling', {}],
  ])('returns undefined for %s — an absence, never a stand-in for now', (_label, meta) => {
    expect(metaRefreshedAt(meta as undefined)).toBeUndefined();
  });

  it('does NOT invent a timestamp when the envelope carries none', () => {
    // The failure mode this whole correction is about: an absent stamp must
    // reach the chip as absent, so the chip can say so. Returning Date.now()
    // here would restore the exact lie, one layer lower down.
    const before = Date.now();
    const got = metaRefreshedAt({});
    expect(got).toBeUndefined();
    expect(typeof got).not.toBe('string');
    expect(Date.now()).toBeGreaterThanOrEqual(before);
  });
});
