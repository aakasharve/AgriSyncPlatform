import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import type { OpsHealthData } from '@/hooks/useOpsHealth';
import OpsLivePage from '../OpsLivePage';

/**
 * CR-2e Task 5 (page part, C29, C30, C11): Live Health shows the two alert checks for real. R9 (server errors in an
 * hour) comes from the polled health answer's `alertR9`; R10 (voice failing in six hours) from its own route
 * `GET /shramsafal/admin/ops/voice-check`, asked once when the page opens and again only on "Check again".
 * Each shows its state in words, the counted figure and its window in India time. "Not judged" never reads as clear.
 * The console never reads the old `apiErrorSpike` / `voiceDegraded` fields. Expected text comes from the spec.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const WAIT = { timeout: 15_000 };

// India time is UTC+05:30. These windows are chosen so the India clock digits differ from the UTC ones.
const R9_START = '2026-11-18T03:41:00Z'; // 09:11 India
const R9_END = '2026-11-18T04:41:00Z'; // 10:11 India
const R10_START = '2026-11-17T22:07:00Z'; // 03:37 India, 18 Nov
const R10_END = '2026-11-18T04:07:00Z'; // 09:37 India

interface Check {
  rule: 'R9' | 'R10'; state: 'breach' | 'clear' | 'not_judged'; counted: number | null; outOf: number | null;
  windowStartUtc: string; windowEndUtc: string; reason: string | null;
}
const r9 = (state: Check['state'], counted: number): Check => ({
  rule: 'R9', state, counted, outOf: null, windowStartUtc: R9_START, windowEndUtc: R9_END, reason: null,
});
const r10 = (over: Partial<Check> = {}): Check => ({
  rule: 'R10', state: 'clear', counted: 1, outOf: 10, windowStartUtc: R10_START, windowEndUtc: R10_END, reason: null, ...over,
});

function health(over: Record<string, unknown> = {}): OpsHealthData {
  return {
    voiceInvocations24h: 0, voiceFailures24h: 0, voiceFailureRatePct: 0, voiceAvgLatencyMs: 0, voiceP95LatencyMs: 0,
    recentErrors: [], topSufferingFarms: [], apiErrorSpike: false, voiceDegraded: false,
    computedAtUtc: new Date().toISOString(),
    alertR9: r9('clear', 0),
    ...over,
  } as unknown as OpsHealthData;
}

type Reply = { status: number; data: unknown };
let stub: StubbedAdapter | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  vi.useRealTimers();
  localStorage.clear();
});

function serve(healthBody: () => unknown, voice: () => Reply | Promise<Reply>) {
  stub = installAdapter(async (req) => {
    if (req.url.includes('/admin/ops/voice-check')) return voice();
    if (req.url.includes('/admin/ops/health')) return { status: 200, data: healthBody() };
    return { status: 200, data: null };
  });
  return stub;
}
const ok = (c: Check): Reply => ({ status: 200, data: c });
const voiceCalls = () => stub!.requests.filter((r) => r.url.includes('/admin/ops/voice-check'));
const render = (queryClient = makeTestQueryClient()) =>
  renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}`, queryClient });
const body = () => document.body.textContent ?? '';
/** Text nodes joined with a space, so words in neighbouring elements never run together. */
function spoken(root: Node): string {
  const out: string[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if ((n.textContent ?? '').trim()) out.push((n.textContent ?? '').trim());
  return out.join(' ');
}
/** The Automatic checks section (the page's own heading names it). */
const checks = () => screen.getByRole('heading', { name: 'Automatic checks' }).closest('section')!;
const clockOf = (hhmm: string) => new RegExp(`(^|\\D)0?${hhmm.replace(/^0/, '')}(\\D|$)`);

async function settled() {
  await waitFor(() => expect(screen.queryAllByRole('status', { name: /Loading/ })).toHaveLength(0), WAIT);
  await waitFor(() => expect(document.querySelector('.chip-fresh')).not.toBeNull(), WAIT);
}

describe('Live Health alert checks (L1, real)', () => {
  it('Alerts_show_state_count_and_window', async () => {
    serve(() => health({ alertR9: r9('breach', 31) }), () => ok(r10({ state: 'breach', counted: 3, outOf: 10 })));
    render();
    await settled();
    await waitFor(() => expect(body()).toMatch(/3 of 10 recordings failed/), WAIT);

    // R9: the state in words, the counted figure, the window in India time (not UTC).
    expect(body()).toMatch(/Problem/);
    expect(body()).toMatch(/31 errors/);
    expect(body()).toMatch(clockOf('09:11'));
    expect(body()).toMatch(clockOf('10:11'));
    expect(body()).not.toMatch(/(^|\D)0?3:41(\D|$)/);

    // R10: its count and its six-hour window in India time.
    expect(body()).toMatch(clockOf('03:37'));
    expect(body()).toMatch(clockOf('09:37'));
    expect(body()).not.toMatch(/(^|\D)22:07(\D|$)/);
  });

  it('a clear R9 and a clear R10 are each shown as Clear with their counts', async () => {
    serve(() => health({ alertR9: r9('clear', 30) }), () => ok(r10({ state: 'clear', counted: 2, outOf: 10 })));
    render();
    await settled();
    await waitFor(() => expect(body()).toMatch(/2 of 10 recordings failed/), WAIT);
    expect(body()).toMatch(/30 errors/);
    expect(spoken(checks()).match(/\bClear\b/g)?.length ?? 0).toBe(2);
    expect(spoken(checks())).not.toMatch(/\bProblem\b/);
  });

  it('Not_judged_never_reads_as_clear', async () => {
    // R9 is a breach, so no honest "Clear" can appear anywhere beside the R10 answer under test.
    const reasons = ['too_few_recordings', 'too_many_farms_for_live_count', 'farm_list_unreadable'];
    for (const reason of reasons) {
      const tooFew = reason === 'too_few_recordings';
      serve(
        () => health({ alertR9: r9('breach', 40) }),
        () => ok(r10({ state: 'not_judged', counted: tooFew ? 1 : null, outOf: tooFew ? 2 : null, reason })),
      );
      const view = render();
      await settled();
      await waitFor(() => expect(body()).toMatch(/Not judged/i), WAIT);

      expect(spoken(checks()), reason).not.toMatch(/\bClear\b/i);
      // No success colour is applied in the checks while the only judged check is a breach.
      const classes = [...checks().querySelectorAll('[class]')].map((e) => e.getAttribute('class') ?? '').join(' ');
      expect(classes, reason).not.toMatch(/green|success/i);
      expect(document.querySelector('[data-tone="ok"], [data-state="clear"], [data-state="ok"]'), reason).toBeNull();
      // The reason is given in words (a code is never printed).
      expect(body(), reason).not.toContain(reason);

      view.unmount();
      stub!.restore();
      stub = null;
    }
  });

  it('Too_few_recordings_says_not_enough_recordings_to_judge', async () => {
    // Review Focus 4: two recordings, one failed, is neither "voice failing" nor "clear".
    serve(() => health({ alertR9: r9('clear', 0) }), () => ok(r10({ state: 'not_judged', counted: 1, outOf: 2, reason: 'too_few_recordings' })));
    render();
    await settled();
    await waitFor(() => expect(body()).toMatch(/Not judged/i), WAIT);
    expect(body()).toMatch(/not enough recordings to judge/i);
  });

  it('a missing alertR9 shows no verdict word for R9', async () => {
    serve(
      () => { const h = health(); delete (h as unknown as Record<string, unknown>).alertR9; return h; },
      () => ok(r10({ state: 'not_judged', counted: null, outOf: null, reason: 'farm_list_unreadable' })),
    );
    render();
    await settled();
    await waitFor(() => expect(body()).toMatch(/Not judged/i), WAIT);
    expect(spoken(checks())).not.toMatch(/\bClear\b/);
    expect(spoken(checks())).not.toMatch(/\bProblem\b/);
    expect(spoken(checks())).not.toMatch(/\d+ errors/);
  });

  it('the console never reads apiErrorSpike or voiceDegraded', async () => {
    serve(
      () => health({ apiErrorSpike: true, voiceDegraded: true, alertR9: r9('clear', 4) }),
      () => ok(r10({ state: 'clear', counted: 0, outOf: 12 })),
    );
    render();
    await settled();
    await waitFor(() => expect(body()).toMatch(/0 of 12 recordings failed/), WAIT);
    expect(spoken(checks())).toMatch(/\bClear\b/);
    expect(spoken(checks())).not.toMatch(/\bProblem\b/);
    expect(body()).not.toMatch(/BREACH/);
  });

  it('a failed voice check says it could not load, with the other check unaffected', async () => {
    serve(() => health({ alertR9: r9('breach', 31) }), () => ({ status: 500, data: { code: 'boom' } }));
    render();
    await settled();
    await waitFor(() => expect(body()).toMatch(/could not load/i), WAIT);
    expect(body()).toMatch(/31 errors/);
    expect(body()).not.toMatch(/recordings failed/);
  });

  it('A_refused_voice_check_reads_not_available_for_this_account', async () => {
    serve(() => health({ alertR9: r9('clear', 0) }), () => ({ status: 403, data: { code: 'admin_platform_only' } }));
    render();
    await settled();
    await waitFor(() => expect(body()).toMatch(/not available for this account/i), WAIT);
    expect(screen.queryByRole('button', { name: /Check again/i })).toBeNull();
    expect(body()).not.toMatch(/admin_platform_only/);
    expect(body()).not.toMatch(/could not load/i);
  });
});

describe('the voice check is requested once (C11)', () => {
  it('The_voice_check_is_asked_once_and_on_check_again_only', async () => {
    // Fake timers are installed BEFORE mount so a timer set at mount is seen.
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] });
    serve(() => health({ alertR9: r9('clear', 0) }), () => ok(r10({ state: 'clear', counted: 1, outOf: 10 })));
    render();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(voiceCalls()).toHaveLength(1);

    // Over a minute passes (the page polls health every 30 s) and the window gets focus: still one request.
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(voiceCalls(), 'the voice check was asked again without a click').toHaveLength(1);

    // "Check again" makes exactly one more.
    const button = screen.getByRole('button', { name: /Check again/i });
    await act(async () => { fireEvent.click(button); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(voiceCalls()).toHaveLength(2);

    // and nothing further by itself.
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(voiceCalls()).toHaveLength(2);
  }, 90_000);
});
