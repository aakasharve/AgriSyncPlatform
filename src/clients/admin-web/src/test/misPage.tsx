import { useState } from 'react';
import { screen } from '@testing-library/react';
import MisPage from '@/features/mis/MisPage';
import type { MisSectionKey } from '@/features/mis/misItems';
import { COMPANY_MIS_PATH, type CompanyMis } from '@/hooks/useCompanyMis';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type CapturedRequest, type StubbedAdapter } from '@/test/stubAdapter';
import { misEnvelope, misFixture } from '@/test/misFixture';

/** Helpers for mounting the Company MIS pages in tests (CR-2b, test-writer). */

export const MIS_SECTIONS: MisSectionKey[] = ['overview', 'acquisition', 'engagement', 'retention', 'quality', 'farms', 'operations'];

/** 15 Nov 2026, 2:32 pm India time: the fixture's countedAtUtc, and "now" for the page. */
export const MIS_NOW = new Date('2026-11-15T09:02:00Z');

/** The page with a row of buttons that switch section, like the menu does. */
export function MisHost({ initial }: { initial: MisSectionKey }) {
  const [section, setSection] = useState<MisSectionKey>(initial);
  return (
    <>
      <nav aria-label="test sections">
        {MIS_SECTIONS.map((s) => (
          <button key={s} type="button" onClick={() => setSection(s)}>{`open ${s}`}</button>
        ))}
      </nav>
      <MisPage section={section} />
    </>
  );
}

export function serveMis(
  answer: (req: CapturedRequest) => Promise<{ status: number; data: unknown }> = async () => ({ status: 200, data: misEnvelope() }),
): StubbedAdapter {
  return installAdapter(async (req) => {
    if (req.url.includes(COMPANY_MIS_PATH)) return answer(req);
    return { status: 200, data: { data: null, meta: { source: 'live', window: '', lastRefreshedUtc: null, ttlSeconds: 0 } } };
  });
}

export function misCalls(stub: StubbedAdapter): CapturedRequest[] {
  return stub.requests.filter((r) => r.url.includes(COMPANY_MIS_PATH));
}

export function renderMis(section: MisSectionKey) {
  return renderWithProviders(<MisHost initial={section} />);
}

/** Waits until the answer is on screen. */
export async function countedShown() {
  return screen.findByTestId('mis-counted-at', undefined, { timeout: 10_000 });
}

/** The page's text that could carry a number: everything except the range controls and the range label. */
export function pageTextWithoutRange(): string {
  const dash = screen.getByTestId('mis-dashboard').cloneNode(true) as HTMLElement;
  dash.querySelectorAll('[role="group"][aria-label="Date range"], [data-testid="mis-range-label"]').forEach((e) => e.remove());
  return dash.textContent ?? '';
}

export function fixtureFor(overrides?: Parameters<typeof misFixture>[0]): CompanyMis {
  return misFixture(overrides);
}
