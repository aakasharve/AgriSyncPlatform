/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  EmptyState,
  ErrorState,
  FeedDown,
  InterventionQueueEmpty,
  LoadFailed,
  LoadingState,
  Masked,
  MeasuredZero,
  NoMatch,
  NotMeasured,
  NotMeasuredPanel,
  REDACTED,
  ScoringActiveBanner,
  STATE_WORD,
  formatError,
  isPartlyMasked,
  isRedacted,
  stateWord,
  type HonestState,
} from '@/components/state';


/**
 * THE HONESTY RULES, WITH TEETH.
 *
 * Seven screens in this console render a 500, a timeout or a 403 as good news
 * — "No errors found. The system is healthy." This file is the reason that
 * cannot come back through the new vocabulary.
 *
 * Every assertion below is on BEHAVIOUR or on RENDERED WORDS, never on a
 * Tailwind class string, so a restyle in Tasks 22-26 cannot make an honesty
 * rule fail and cannot make one pass either.
 */

const CAUSES: Array<[HonestState, string]> = [
  ['unmeasured', 'not measured'],
  ['feed-down', 'feed down'],
  ['never', 'never'],
  ['unattributed', 'not attributable'],
];

/* ══════════════════════════════ NotMeasured ═══════════════════════════════ */

describe('NotMeasured — the only component allowed to print a missing value', () => {
  it('never renders a zero for an unmeasured value', () => {
    render(<NotMeasured />);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    // Em dash PLUS a caption. A bare dash is the same collapse in quieter
    // clothing — the reader supplies the reason, and it is usually "zero".
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('not measured')).toBeInTheDocument();
  });

  it.each(CAUSES)('names the cause in words for state=%s', (state, word) => {
    render(<NotMeasured state={state} />);
    expect(document.querySelector('[data-state]')).toHaveAttribute('data-state', state);
    expect(screen.getByText(word)).toBeInTheDocument();
  });

  it('gives a screen reader the reason and a sighted reader both', () => {
    render(<NotMeasured state="feed-down" why="the collector stopped at 06:12" />);
    // The dash is hidden from assistive tech; the word is not.
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('feed down')).not.toHaveAttribute('aria-hidden');
    expect(document.querySelector('[data-state="feed-down"]')).toHaveAttribute(
      'title',
      'the collector stopped at 06:12'
    );
  });

  it('has exactly four causes — a fifth word silently widens KpiState', () => {
    expect(Object.keys(STATE_WORD).sort()).toEqual(
      ['feed-down', 'never', 'unattributed', 'unmeasured'].sort()
    );
    // An unrecognised state degrades to "not measured", never to a blank.
    expect(stateWord(undefined)).toBe('not measured');
    expect(stateWord(null)).toBe('not measured');
  });
});

/* ═════════════════════════════ MeasuredZero ═══════════════════════════════ */

describe('MeasuredZero — we looked, and it really is none', () => {
  it('says so in words, and names when it checked', () => {
    render(<MeasuredZero what="No errors in the last 2 hours" checkedAt="11:41" />);

    const block = screen.getByRole('status');
    expect(block).toHaveAttribute('data-state', 'measured-zero');
    expect(block).toHaveTextContent('No errors in the last 2 hours');
    // The window is the whole point: "nothing here" with no window behind it
    // is indistinguishable from a feed that died.
    expect(block).toHaveTextContent('The window was checked at 11:41.');
    expect(block).toHaveTextContent('This is a measured zero, not a missing feed.');
  });

  it('is not a celebration — no green tick copy, and no 0', () => {
    render(<MeasuredZero what="No errors in the last 2 hours" checkedAt="11:41" />);
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).not.toMatch(/healthy|great|all clear|nothing to worry/i);
    expect(screen.queryByText('0')).toBeNull();
  });
});

/* ═══════════════════════════════ NoMatch ══════════════════════════════════ */

describe('NoMatch — your filter excluded everything, which is not a zero', () => {
  it('names the filter and offers the way out', async () => {
    const onClear = vi.fn();
    render(<NoMatch filterInWords={'“भोसले”'} onClear={onClear} />);

    const block = screen.getByRole('status');
    expect(block).toHaveAttribute('data-state', 'no-match');
    expect(block).toHaveTextContent('Nothing matches “भोसले”');

    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('is explicitly NOT a measured zero — the two are different truths', () => {
    render(<NoMatch filterInWords="tier = Pro" onClear={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('That is not a measured zero');
    // …and it does not borrow the measured-zero identity.
    expect(document.querySelector('[data-state="measured-zero"]')).toBeNull();
  });

  it('can say what the filter searches over (v3 §6.1)', () => {
    render(
      <NoMatch
        filterInWords="“patil”"
        onClear={() => {}}
        searchesOver="Search runs over farm name, owner and phone."
      />
    );
    expect(
      screen.getByText('Search runs over farm name, owner and phone.')
    ).toBeInTheDocument();
  });
});

/* ══════════════════════════════ FeedDown ══════════════════════════════════ */

describe('FeedDown — the feed stopped', () => {
  it('names when the feed stopped', () => {
    render(<FeedDown since="06:12 today" what="The logs-today collector" />);

    const block = screen.getByRole('alert');
    expect(block).toHaveAttribute('data-state', 'feed-down');
    // CONTRACT.md §6.3: must contain the words "feed down" AND when it stopped.
    expect(block.textContent?.toLowerCase()).toContain('feed down');
    expect(block).toHaveTextContent('Feed down since 06:12 today');
    expect(block).toHaveTextContent(
      'The logs-today collector stopped at 06:12 today and has not emitted since.'
    );
    expect(block).toHaveTextContent('Nothing below this line is current.');
  });

  it('NEVER presents the last good number as current', () => {
    render(<FeedDown since="06:12 today" lastGood="41 logs at 06:11" />);
    const block = screen.getByRole('alert');

    // 1. The stale figure appears EXACTLY ONCE. Lifting it into a heading, a
    //    KPI value or a summary line — the shape this test exists to catch —
    //    makes this two.
    const occurrences = (block.textContent ?? '').split('41 logs at 06:11').length - 1;
    expect(occurrences).toBe(1);

    // 2. And the one place it appears is the sentence that disowns it. A
    //    stale number presented as today's is the most damaging thing this
    //    console can do to a decision.
    const carrier = within(block).getByText(/41 logs at 06:11/);
    expect(carrier).toHaveTextContent(
      "The last figure it produced was 41 logs at 06:11 — that is history, not today's count."
    );
    expect(carrier).toHaveAttribute('data-lastgood');
  });

  it('renders no last-good sentence at all when there is no last good figure', () => {
    render(<FeedDown since="06:12 today" />);
    expect(document.querySelector('[data-lastgood]')).toBeNull();
    expect(screen.getByRole('alert').textContent).not.toContain('The last figure');
  });
});

/* ═════════════════════════════ LoadFailed ═════════════════════════════════ */

describe('LoadFailed — the request broke, and it is always retryable', () => {
  it('is never dressed as an empty result', () => {
    render(
      <LoadFailed
        error={new Error('Request failed with status code 500')}
        onRetry={() => {}}
        what="the error feed"
      />
    );
    const block = screen.getByRole('alert');
    expect(block).toHaveAttribute('data-state', 'load-failed');
    expect(block).toHaveTextContent("Couldn't load the error feed.");
    expect(block).toHaveTextContent('Request failed with status code 500');
    expect(block).toHaveTextContent('this is not an empty result');
    // The exact sentence D9 catalogues, in any of its seven spellings.
    expect(block.textContent ?? '').not.toMatch(/healthy|no errors found|great!/i);
  });

  it('always renders a working Retry — unlike ErrorState, it is not optional', async () => {
    const onRetry = vi.fn();
    render(<LoadFailed error="boom" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

/* ════════════════════════════ formatError ═════════════════════════════════ */

describe('the formatError unwrapping ladder is intact (A41)', () => {
  it.each([
    [null, 'Unknown error.'],
    [undefined, 'Unknown error.'],
    ['plain string', 'plain string'],
    [new Error('boom'), 'boom'],
    [{ message: 'axios said no' }, 'axios said no'],
    [{ message: 404 }, 'Unexpected error — see console.'],
    [{ nope: true }, 'Unexpected error — see console.'],
  ])('%o -> %s', (input, expected) => {
    expect(formatError(input)).toBe(expected);
  });
});

/* ═════════════════════════ promoted primitives ════════════════════════════ */

describe('LoadingState keeps its accessibility contract (A32)', () => {
  it('is announced as busy, and NAMES which block is loading', () => {
    render(<LoadingState label="Loading intervention queue" height={220} />);

    const block = screen.getByRole('status');
    expect(block).toHaveAttribute('aria-busy', 'true');
    // A page with five unnamed panels loading produces five identical
    // announcements, which is the same as none.
    expect(block).toHaveAttribute('aria-label', 'Loading intervention queue');
    // The sr-only span carries the same words as text, for readers that
    // ignore aria-label on a generic element.
    expect(within(block).getByText('Loading intervention queue')).toHaveClass('sr-only');
    expect(block).toHaveStyle({ height: '220px' });
  });
});

/*
 * ERRORSTATE HAS ZERO CALL SITES AFTER TASK 23, AND IS KEPT DELIBERATELY.
 *
 * Task 23 moved the last two panels to `LoadFailed`, whose Retry is REQUIRED
 * rather than optional. `ErrorState`'s Retry is optional, which is the
 * difference, and the Preservation Register carries it as A41 — the working
 * Retry wired to refetch() plus the `formatError` unwrapping ladder. Deleting
 * it in Task 27 would drop a registered guarantee on the quiet grounds that
 * nothing currently calls it, which is exactly the move the register exists
 * to stop. It stays, and this test is why it is not dead weight.
 */
describe('ErrorState keeps its working Retry (A41) — zero call sites, kept on purpose', () => {
  it('calls refetch when Retry is pressed', async () => {
    const refetch = vi.fn();
    render(<ErrorState error={new Error('nope')} onRetry={refetch} />);

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load farmer-health data.");
    expect(screen.getByRole('alert')).toHaveTextContent('nope');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders no button when no retry was supplied — preserved behaviour', () => {
    render(<ErrorState error="offline" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

/* Counted at Task 27: ONE call site, `InterventionQueueEmpty`. The other nine
 * moved to the four named causes in Tasks 22-23. */
describe('EmptyState still renders for its one remaining call site', () => {
  it('shows the message and the optional hint', () => {
    render(<EmptyState message="No activity yet" hint="Nothing was logged this week." />);
    expect(screen.getByRole('status')).toHaveTextContent('No activity yet');
    expect(screen.getByText('Nothing was logged this week.')).toBeInTheDocument();
  });
});

/* ══════════════════════ mandatory copy (C5 / A35) ═════════════════════════ */

const BANNER_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/state/ScoringActiveBanner.tsx'),
  'utf-8'
);

describe('ScoringActiveBanner — MANDATORY copy per C5, do not paraphrase', () => {
  it('read the real file — not an empty stub', () => {
    // vitest.config.ts sets `css: false`, which stubs every css request —
    // `?raw` included — to ''. This file is .tsx and read from disk, but the
    // length check stays: a test asserting against '' passes against nothing.
    expect(BANNER_SOURCE.length).toBeGreaterThan(500);
  });

  it('the scoring banner copy is byte-identical', () => {
    render(<ScoringActiveBanner deployDate="first deploy" />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Scoring active from first deploy; data accumulating.'
    );
  });

  it('falls back to "first deploy" and is announced politely', () => {
    render(<ScoringActiveBanner />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Scoring active from first deploy; data accumulating.');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('interpolates a real deploy date without touching the rest of the sentence', () => {
    render(<ScoringActiveBanner deployDate="14 Aug 2026" />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Scoring active from 14 Aug 2026; data accumulating.'
    );
  });

  it('carries its red-line comment with it', () => {
    // A red-line comment that does not travel with the code it guards stops
    // being a red line. This is the assertion that makes it travel.
    expect(BANNER_SOURCE).toContain('MANDATORY copy per C5 — do not paraphrase');
    expect(BANNER_SOURCE).toContain('Scoring active from {DEPLOY_DATE}; data accumulating.');
  });
});

/* ══════════════ the intervention queue's two truths (A36) ═════════════════ */

describe('InterventionQueueEmpty — two truths, never one celebration', () => {
  it('an EMPTY cohort makes no claim about farms nobody has scored', () => {
    render(<InterventionQueueEmpty understated />);
    expect(screen.getByRole('status')).toHaveTextContent('No farms in intervention bucket yet.');
    // No hint: saying "all scored farms are above the threshold" over an
    // unscored cohort is a claim about farms that were never measured.
    expect(screen.queryByText(/above the 40-pt intervention threshold/)).toBeNull();
  });

  it('a SCORED cohort that is all clear says so, and says why', () => {
    render(<InterventionQueueEmpty />);
    const block = screen.getByRole('status');
    expect(block).toHaveTextContent('No farms in intervention bucket.');
    expect(block).toHaveTextContent('All scored farms are above the 40-pt intervention threshold.');
  });

  it('the two variants do not render the same words', () => {
    const { container: understated, unmount } = render(<InterventionQueueEmpty understated />);
    const a = understated.textContent;
    unmount();
    const { container: normal } = render(<InterventionQueueEmpty />);
    expect(normal.textContent).not.toBe(a);
  });
});

/* ═══════════════════════ masking as a state (A14/B16) ═════════════════════ */

describe('Masked — a hidden value is a state, not a string', () => {
  it('classifies the three shapes the server actually sends', () => {
    expect(isRedacted(REDACTED)).toBe(true);
    expect(isRedacted('98******12')).toBe(false);
    expect(isRedacted('Purvesh Arve')).toBe(false);
    expect(isPartlyMasked('98******12')).toBe(true);
    expect(isPartlyMasked(REDACTED)).toBe(false);
    expect(isPartlyMasked('9876543210')).toBe(false);
  });

  it('falls back to the farm id and NEVER prints the redaction marker', () => {
    // FarmerHealthDrilldown.tsx:55 falls back only on an EMPTY name today, so
    // a redacted name is printed verbatim into the page title. This is the fix.
    render(<Masked value={REDACTED} fallback="f-0042" />);
    expect(screen.getByText('f-0042')).toBeInTheDocument();
    expect(screen.queryByText(REDACTED)).toBeNull();
    expect(document.querySelector('[data-masked]')).toHaveAttribute('data-masked', 'redacted');
  });

  it('with no fallback, says the value is hidden rather than absent', () => {
    render(<Masked value={REDACTED} />);
    expect(screen.getByText('hidden')).toBeInTheDocument();
    expect(screen.queryByText(REDACTED)).toBeNull();
    expect(screen.queryByText('not measured')).toBeNull();
  });

  it('renders a PARTLY masked phone exactly as sent — it is still usable', () => {
    render(<Masked value="98******12" />);
    expect(screen.getByText('98******12')).toBeInTheDocument();
    expect(document.querySelector('[data-masked]')).toHaveAttribute('data-masked', 'partial');
  });

  it('sends a genuinely absent value to NotMeasured, not to a blank', () => {
    render(<Masked value={null} />);
    expect(screen.getByText('not measured')).toBeInTheDocument();
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders an unmasked value untouched', () => {
    render(<Masked value="Purvesh Arve" />);
    expect(screen.getByText('Purvesh Arve')).toBeInTheDocument();
    expect(document.querySelector('[data-masked]')).toHaveAttribute('data-masked', 'none');
  });
});

/* ══════════════════════ §6.4 no source at all ═════════════════════════════ */

describe('NotMeasuredPanel — a panel with no data source, not a broken one', () => {
  it('states the reason as text, not as a tooltip', () => {
    render(
      <NotMeasuredPanel why="The DB-backed admin table ssf.admin_users has never been read." />
    );
    const block = screen.getByRole('status');
    expect(block).toHaveAttribute('data-state', 'unmeasured');
    expect(block).toHaveTextContent('Not measured');
    expect(block).toHaveTextContent(
      'The DB-backed admin table ssf.admin_users has never been read.'
    );
  });
});

/* ═══════════════════════ the shim is gone (Task 27) ═══════════════════════ */

/*
 * `features/farmer-health/components/EmptyAndErrorStates.tsx` WAS HERE, as a
 * four-symbol re-export, and this file asserted the re-exports were the same
 * objects rather than copies.
 *
 * Task 5 created that shim so the build stayed green from Task 5 to Task 23
 * while ten importers migrated one screen at a time, and Task 5's own note
 * said it dies here. Measured at Task 27: its last importer was THIS FILE —
 * the test of the shim was the only thing still importing the shim, which is
 * the point at which a bridge is carrying nothing but its own weight.
 *
 * Deleted. The four symbols are asserted above, at their real path.
 */
