import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import raw from '@/__tests__/fixtures/b24-metric-lines.json?raw';
import { MIS_ITEMS, MIS_SLOTS } from '@/features/mis/misItems';
import { resetMisPeriod } from '@/features/mis/misPeriod';
import type { StubbedAdapter } from '@/test/stubAdapter';
import { MIS_NOW, MIS_SECTIONS, countedShown, renderMis, serveMis } from '@/test/misPage';

/**
 * B24 (2026-11-17): every Company MIS tile and chart card shows its two lines as visible text,
 * except the seven headline items (n 14, 25, 32, 42, 53, 62, 73). Expected text is pinned from the
 * reviewed lines file (fixtures/b24-metric-lines.json); a not-measured item keeps its reason after the lines.
 */

interface Entry { page: string; key: string; status: string; what?: string; why?: string }
const MIS = (JSON.parse(raw) as Entry[]).filter((e) => e.page.startsWith('MIS'));
const byKey = new Map(MIS.map((e) => [e.key, e]));
const HEADLINE_KEYS = new Set(MIS_ITEMS.filter((i) => [14, 25, 32, 42, 53, 62, 73].includes(i.n)).map((i) => i.key));

let stub: StubbedAdapter | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MIS_NOW);
  resetMisPeriod();
});
afterEach(() => {
  stub?.restore();
  stub = null;
  vi.useRealTimers();
});

describe('the two lines on the Company MIS pages (B24)', () => {
  it('B24_every_rendered_MIS_tile_and_card_shows_its_what_and_why_as_text', async () => {
    let shownWithLines = 0;
    for (const s of MIS_SECTIONS) {
      stub = serveMis();
      const v = renderMis(s);
      await countedShown();
      const items = [...v.container.querySelectorAll<HTMLElement>('[data-mis-item]')];
      expect(items.length).toBeGreaterThan(3);
      for (const el of items) {
        const key = el.getAttribute('data-mis-item')!;
        if (MIS_SLOTS.some((x) => x.key === key)) continue; // a sub-line of a parent item, not an item
        const e = byKey.get(key);
        expect(e, `${key} has a reviewed entry`).toBeTruthy();
        const text = el.textContent ?? '';
        if (HEADLINE_KEYS.has(key)) continue;
        expect(text, `${key} what line`).toContain(e!.what!);
        expect(text, `${key} why line`).toContain(e!.why!);
        shownWithLines += 1;
      }
      v.unmount();
      stub.restore();
      stub = null;
      resetMisPeriod();
    }
    // 73 items less the seven headline ones: every other one that renders as a tile or card carries both lines.
    expect(shownWithLines).toBeGreaterThanOrEqual(40);
  });

  it('B24_a_not_measured_item_shows_what_why_then_its_reason_and_keeps_the_MIS_wording', async () => {
    stub = serveMis();
    const v = renderMis('overview');
    await countedShown();
    const installs = byKey.get('overview.installs')!;
    const el = v.container.querySelector<HTMLElement>('[data-mis-item="overview.installs"]')!;
    const text = el.textContent ?? '';
    const iWhat = text.indexOf(installs.what!);
    const iWhy = text.indexOf(installs.why!);
    const iReason = text.indexOf('Only Google Play knows');
    expect(iWhat).toBeGreaterThanOrEqual(0);
    expect(iWhy).toBeGreaterThan(iWhat);
    expect(iReason).toBeGreaterThan(iWhy);
    expect(text.toLowerCase()).toContain('not measured');
    expect(text).not.toContain('Not built yet');
  });

  it('B24_MIS_pages_never_say_Not_built_yet_and_never_say_AI', async () => {
    for (const s of MIS_SECTIONS) {
      stub = serveMis();
      const v = renderMis(s);
      await countedShown();
      const text = v.container.textContent ?? '';
      expect(text, s).not.toContain('Not built yet');
      expect(text, s).not.toMatch(/\bAI\b/);
      v.unmount();
      stub.restore();
      stub = null;
      resetMisPeriod();
    }
  });
});
