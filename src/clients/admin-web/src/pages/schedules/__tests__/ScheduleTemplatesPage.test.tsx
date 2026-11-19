import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles } from '@/test/stubAdapter';
import type { StubbedAdapter } from '@/test/stubAdapter';
import {
  SCHEDULE_TEMPLATES_404_PATH,
  SCHEDULE_TEMPLATES_PATH,
} from '@/hooks/useScheduleTemplates';
import type { ScheduleTemplate } from '@/hooks/useScheduleTemplates';
import ScheduleTemplatesPage from '../ScheduleTemplatesPage';

/**
 * SCHEDULE TEMPLATES — the screen that had never once reached its endpoint.
 *
 * The central claims of this file, in order of how much they matter:
 *
 *  1. THE PATH. The console asked for
 *     `/shramsafal/reference-data/crop-schedule-templates`; the server
 *     publishes `/shramsafal/reference/schedule-templates`. Every request 404'd
 *     and the screen rendered that as "No schedule templates found."
 *  2. NO FRESHNESS CHIP, because there is no timestamp — and the words that
 *     replace it say so rather than implying an age (D13).
 *  3. A TEMPLATE WITH NO TASK LIST IS NOT A TEMPLATE WITH ZERO TASKS.
 *  4. NO PUBLICATION CLAIM. The field is not on this endpoint, so the screen
 *     may not print "Draft" — which is what it did, on every card, for every
 *     template, the moment the URL was corrected.
 *  5. AN EMPTY ANSWER IS NOT A MEASURED ZERO on this feed, because the server
 *     substitutes four built-in templates when the table is empty.
 *
 * SETTLE_WAIT — measured 2026-09-01 by Task 19 and carried with its reason.
 * Under full-suite parallelism forty-odd jsdom environments compete for the
 * same cores and a block has not always finished changing inside Testing
 * Library's 1000 ms default. Nothing is weakened; a real regression still fails,
 * it just fails after waiting. `vitest.config.ts` is untouched.
 *
 * MOUNT BUDGET, AND IT IS NOT A STYLE CHOICE. Task 14 measured a timing cliff
 * and Task 29 owns it; Task 18 met it and merged its file onto shared fixtures.
 * The first draft of this file mounted the screen FIFTEEN times and took the
 * 41-file suite from green to two failures in four runs — always the same
 * whole-console test in `deepLink.contract.test.tsx`, never anything here.
 * Merged onto SEVEN mounts. **No assertion was dropped to do it**; the describe
 * blocks below still separate the claims, they just share a render.
 */

const SETTLE_WAIT = 15_000;
const ORG = '11111111-1111-1111-1111-111111111111';

/* ═══════════════════════════════════════════════════════════ fixtures ════ */

/** The REAL `ScheduleTemplateDto` (`ReferenceDataDtos.cs:17-24`) — seven fields
 *  and no more. Written from the server, not from the page. */
function template(over: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return {
    id: 'f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77301',
    name: 'Grapes - Standard Seasonal Template',
    cropType: 'Grapes',
    totalDays: 150,
    stages: [{ name: 'Post Pruning', startDay: 0, endDay: 29 }],
    activities: [
      {
        name: 'Pruning',
        category: 'Pruning',
        stageName: 'Post Pruning',
        startDay: 0,
        endDay: 0,
        frequencyMode: 'one_time',
        intervalDays: null,
      },
      {
        name: 'Spraying',
        category: 'Spraying',
        stageName: 'Post Pruning',
        startDay: 18,
        endDay: 18,
        frequencyMode: 'every_n_days',
        intervalDays: 5,
      },
    ],
    versionHash: 'ab12cd34ef567890abcdef',
    ...over,
  };
}

/** A template with a name and nothing else — the unauthored draft. */
function unauthoredTemplate(over: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return template({
    id: 'f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77302',
    name: 'Onion - Rabi Season Template',
    cropType: 'Onion',
    /* The 60-day FLOOR the server reports when nothing is authored — not a
       duration anybody chose. */
    totalDays: 60,
    activities: [],
    ...over,
  });
}

const AUTHORED_ID = 'f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77301';
const DRAFT_ID = 'f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77302';

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function serve(rows: ScheduleTemplate[]) {
  stub = installAdapter(async () => ({ status: 200, data: rows }));
  return stub;
}

function renderTemplates(route = `/schedules/templates?org=${ORG}`) {
  return renderWithProviders(<ScheduleTemplatesPage />, { route });
}

function cardFor(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-template="${id}"]`)!;
}

function cardOrder(): (string | null | undefined)[] {
  return screen
    .getAllByRole('listitem')
    .map((li) => li.querySelector('[data-template]')?.getAttribute('data-template'));
}

/* ══════════════════════════════════ 1. THE PATH — the 404 it always sent ══ */

describe('🔴 the endpoint path — this screen had never reached the API', () => {
  it('requests the published path, sends no parameters, and reads the raw array', async () => {
    serve([template({ name: 'Sugarcane - Standard Annual Template' })]);
    renderTemplates();

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));

    /* ── the path ──────────────────────────────────────────────────────── */
    expect(stub!.requests[0].url).toBe('/shramsafal/reference/schedule-templates');
    expect(SCHEDULE_TEMPLATES_PATH).toBe('/shramsafal/reference/schedule-templates');

    /* The exact string that failed, named in the assertion so a revert reads as
       "this is a 404" rather than "a URL changed". `/reference-data/` is not a
       route group this server has: `ReferenceDataEndpoints.cs:14` opens
       `/reference`, and `crop-schedule-templates` appears in no C# file. */
    for (const request of stub!.requests) {
      expect(
        request.url,
        `${SCHEDULE_TEMPLATES_404_PATH} is not published by the API — it answers 404, ` +
          'and this screen renders a 404 as "no templates exist"',
      ).not.toBe(SCHEDULE_TEMPLATES_404_PATH);
      expect(request.url).not.toContain('reference-data');
      expect(request.url).not.toContain('crop-schedule-templates');
    }

    /* ── no parameters: `HandleAsync(ct)` takes none ───────────────────── */
    expect(stub!.requests[0].url).not.toContain('?');

    /* ── the raw array ─────────────────────────────────────────────────
       The Task 22 defect, on the fourth endpoint with no envelope: reading
       `data.data` off a raw array yields `undefined` and the screen looks empty
       over a perfectly healthy 200. */
    expect(
      await screen.findByText('Sugarcane - Standard Annual Template', undefined, {
        timeout: SETTLE_WAIT,
      }),
    ).toBeInTheDocument();
  });
});

/* ═════════════════════════════════ 2. D13 — no timestamp, so no chip ═════ */

describe('D13 — there is no age here, so there is no chip', () => {
  it('renders no freshness chip, says why in words, and asserts no shortfall it cannot see', async () => {
    serve([template()]);
    const { container } = renderTemplates();

    await screen.findByText('Grapes - Standard Seasonal Template', undefined, {
      timeout: SETTLE_WAIT,
    });

    /* The chip's own class. The old header rendered
       `<FreshnessChip source="materialized" />` with no timestamp, which printed
       a permanent "Nightly · recent" over an endpoint that has no clock. */
    expect(container.querySelector('.chip-fresh')).toBeNull();
    expect(screen.queryByText(/Nightly/)).not.toBeInTheDocument();
    expect(screen.queryByText(/recent/)).not.toBeInTheDocument();
    expect(screen.getByText(/no timestamp available/i)).toBeInTheDocument();

    /* v3's rule, read off the same render: the page can never assert a
       shortfall the data does not carry. "0 templates have no task list" would
       be a sentence about nothing. */
    expect(screen.queryByText(/has no task list/)).not.toBeInTheDocument();
    expect(screen.queryByText(/have no task list/)).not.toBeInTheDocument();
  });
});

/* ══════ 3 + 4. THE UNAUTHORED DRAFT, AND THE FIELD THAT IS NOT SENT ══════ */

describe('a name is not a zero, and an absent field is not a "no"', () => {
  it('never prints a 0, never says Draft, and states the set version once', async () => {
    serve([template(), unauthoredTemplate()]);
    renderTemplates();

    const draft = await waitFor(
      () => {
        const el = cardFor(DRAFT_ID);
        expect(el).not.toBeNull();
        return el;
      },
      { timeout: SETTLE_WAIT },
    );

    /* ── the unauthored draft (Step 5) ─────────────────────────────────
       No zero anywhere in the card, and a named cause in its place. */
    expect(draft.textContent).not.toMatch(/\b0\b/);
    expect(within(draft).getAllByText('not measured').length).toBeGreaterThan(0);
    expect(draft.getAttribute('data-unauthored')).toBe('true');

    /* The 60-day figure the server sends for an unauthored template is its
       floor, not a duration, so it is not printed as one. */
    expect(draft.textContent).not.toContain('60 days');

    /* The authored one still shows its real figures beside it — the absence is
       a property of that template, not a blanket refusal to show numbers. */
    const authored = cardFor(AUTHORED_ID);
    expect(authored.getAttribute('data-unauthored')).toBeNull();
    expect(authored.textContent).toContain('2 activities');
    expect(authored.textContent).toContain('150 days');

    /* And it is accounted for at the foot, BY NAME — v3's rule that the note
       has to match the em dashes the reader can actually see in the card. */
    expect(screen.getByText('One template has no task list')).toBeInTheDocument();
    expect(
      screen.getByText(/neither its task count nor its planning window/).textContent,
    ).toContain('Onion - Rabi Season Template');

    /* ── publication (Step 1's other half) ─────────────────────────────
       `isPublished` is not a field on `ScheduleTemplateDto`, so the old card's
       `t.isPublished ? … : …` was `undefined ? … : …` on every row and every
       template rendered "Draft" — a console telling an operator that no
       schedule is visible to any farmer. Neither word may appear. */
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
    expect(
      screen.getAllByText(/not carried by this feed/i).length,
      'each card must say publication is unknown, rather than leave silence to read as "no"',
    ).toBe(2);

    /* ── the version ───────────────────────────────────────────────────
       `ComputeDtoVersionHash` hashes the WHOLE payload and stamps every row with
       the same value, so a per-card "Version" would invent per-template
       versioning the API does not have. */
    expect(screen.getAllByText('ab12cd34ef56')).toHaveLength(1);
    expect(cardFor(AUTHORED_ID).textContent).not.toContain('ab12cd34');
  });
});

/* ═════════════════ 5. THE FOUR CAUSES over a feed with no clock ══════════ */

describe('the four causes — and the fifth, because an empty answer here is unprovable', () => {
  it('a broken request is named as one, and is retryable', async () => {
    stub = installAdapter(async () => ({ status: 500, data: { message: 'boom' } }));
    renderTemplates();

    const failure = await screen.findByRole('alert', undefined, { timeout: SETTLE_WAIT });
    expect(failure).toBeInTheDocument();
    expect(
      within(failure).getByRole('button', { name: /retry/i }),
      'A41 — a failure state without a working retry is a dead end',
    ).toBeInTheDocument();

    /* The string the old screen printed for a 500, a 404 and a genuine empty
       alike. It cannot be the answer to any of them now. */
    expect(screen.queryByText(/No schedule templates found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Create one via the farming app/i)).not.toBeInTheDocument();
  });

  it('an empty answer is NOT presented as a measured zero, and no time is fabricated', async () => {
    serve([]);
    renderTemplates();

    /* The endpoint cannot return an empty array by design: when the table holds
       no rows the handler answers with four templates hardcoded in C#
       (`GetScheduleTemplatesHandler.cs:31-34`). So "we looked and there are
       none" is a claim this screen is not entitled to make. */
    await screen.findByText(/not a measured zero/i, undefined, { timeout: SETTLE_WAIT });
    expect(screen.getByText(/four templates built into the server/i)).toBeInTheDocument();

    /* MeasuredZero's fixed closing sentence must not be what renders. */
    expect(
      screen.queryByText(/This is a measured zero, not a missing feed/i),
    ).not.toBeInTheDocument();

    /* D5. There is no server clock on this feed, so the only way to print a
       "checked at" would be `new Date()` at render. */
    const page = document.body.textContent ?? '';
    expect(page).not.toContain(String(new Date().getFullYear()));
    expect(page).toMatch(/no timestamp available/i);
  });

  it('shows a card-shaped skeleton while the first answer is in flight', async () => {
    stub = installAdapter(neverSettles);
    renderTemplates();

    expect(
      await screen.findByRole(
        'status',
        { name: 'Loading Schedule templates' },
        { timeout: SETTLE_WAIT },
      ),
    ).toBeInTheDocument();
  });
});

/* ══════════════════ 6. CARDS ON THE ONE LIST COMPONENT ═══════════════════ */

describe('cards, not a table — and still one list component', () => {
  it('renders cards, keeps the sort in a real control, searches in hand, and no-matches honestly', async () => {
    serve([
      template({ id: 'a', name: 'Sugarcane - Annual', cropType: 'Sugarcane' }),
      template({ id: 'b', name: 'Grapes - Seasonal', cropType: 'Grapes' }),
    ]);
    renderTemplates();

    await screen.findByText('Grapes - Seasonal', undefined, { timeout: SETTLE_WAIT });

    /* ── cards (v3 CONTRACT.md Appendix 12) ────────────────────────────── */
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Schedule templates' })).toBeInTheDocument();

    /* The default order: crop ascending, so Grapes precedes Sugarcane. */
    expect(cardOrder()).toEqual(['b', 'a']);

    /* ── the sort a card grid would otherwise lose ──────────────────────
       There is no header row to click, so the same `?sort`/`?dir` keys get an
       explicit control. Losing it is what "cards, not a table" costs when
       nobody notices. */
    expect(screen.getByLabelText('Sort by')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ascending' }));
    await waitFor(() => expect(cardOrder()).toEqual(['a', 'b']));

    /* ── the search, client-side over the answer in hand ────────────────── */
    const before = stub!.requests.length;
    const box = screen.getByLabelText('Search schedule templates');
    await userEvent.type(box, 'grapes{Enter}');

    await waitFor(() => expect(screen.queryByText('Sugarcane - Annual')).not.toBeInTheDocument());
    expect(screen.getByText('Grapes - Seasonal')).toBeInTheDocument();
    expect(stub!.requests.length, 'the whole answer is in hand; searching it is not a fetch').toBe(
      before,
    );

    /* ── a term that matches nothing is about the TERM ──────────────────── */
    await userEvent.clear(box);
    await userEvent.type(box, 'pomegranate{Enter}');

    await screen.findByText(/Nothing matches/i, undefined, { timeout: SETTLE_WAIT });
    /* The unproven-empty block is about the FEED. A term that matched nothing
       is about the term, and the two must not stack. */
    expect(screen.queryByText(/four templates built into the server/i)).not.toBeInTheDocument();
  });
});
