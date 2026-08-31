import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiCard, type KpiState } from '@/components/ui/KpiCard';

/**
 * THE HONESTY OVERRIDE — the point of the whole redesign, in one component.
 *
 * A caller cannot paint an unmeasured number green. `state` outranks `tone`,
 * always, and the tile forces itself grey and forces its value to an em dash
 * no matter what it was handed. That is a BEHAVIOURAL rule (v3 `app.js:363`,
 * "honesty wins"), not a styling preference, which is why it is asserted here
 * rather than trusted to a code review.
 *
 * If a future change adds a caller escape hatch to this — a `forceTone`, an
 * `allowToneWhenUnmeasured`, anything — these tests are the thing that should
 * stop it. Do not weaken them to make such a prop pass.
 */

const NOT_OK: Array<[Exclude<KpiState, 'ok'>, string]> = [
  ['unmeasured', 'not measured'],
  ['feed-down', 'feed down'],
  ['never', 'never'],
  ['unattributed', 'not attributable'],
];

function tile(): HTMLElement {
  // The tone lands on the tile as a data attribute, so this asserts on the
  // component's own contract rather than on a Tailwind class string that a
  // refactor is allowed to change.
  const el = document.querySelector('[data-state]');
  if (!el) throw new Error('KpiCard did not render a tile');
  return el as HTMLElement;
}

describe('KpiCard — honesty outranks tone', () => {
  it('renders grey when state is not ok EVEN THOUGH the caller asked for green', () => {
    render(<KpiCard label="WVFD · goal 4.5" value="4.5" tone="green" state="unmeasured" />);

    // 1. The tone the caller asked for was overridden.
    expect(tile()).toHaveAttribute('data-tone', 'grey');
    expect(tile()).not.toHaveAttribute('data-tone', 'green');

    // 2. It is actually grey on screen, not merely labelled grey: the grey
    //    tint on the tile and --color-text-3 on the figure, which is the one
    //    colour every honesty state uses (CONTRACT.md §7.7).
    expect(tile().className).toContain('bg-tint-grey');
    expect(tile().className).not.toContain('bg-tint-green');
    // The em dash sits in an aria-hidden span; the colour is on the value
    // block that holds it, which is what a sighted admin actually sees.
    expect(screen.getByText('—').parentElement?.className).toContain('text-text-3');

    // 3. The number the caller passed is not shown at all. A grey 4.5 would
    //    still be a claim about a reading that does not exist.
    expect(screen.queryByText('4.5')).toBeNull();
  });

  it.each(NOT_OK)('forces grey and names the cause for state=%s', (state, word) => {
    render(<KpiCard label="MRR" value={0} tone="green" state={state} />);

    expect(tile()).toHaveAttribute('data-tone', 'grey');
    expect(tile()).toHaveAttribute('data-state', state);

    // Never a 0 for a missing reading (CONTRACT.md §9.2). A zero and "we have
    // no reading" are different facts.
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');

    // Sighted users get a dash; screen-reader users get the reason. Four
    // causes, four words — not one undifferentiated "no data".
    expect(screen.getByText(word)).toBeInTheDocument();
  });

  it('suppresses the delta when there is no measurement to have a delta from', () => {
    render(
      <KpiCard label="Voice Success 24h" value="95%" delta="+2.1pp" deltaTrend="up" state="feed-down" />
    );
    expect(screen.queryByText('+2.1pp')).toBeNull();
  });

  it('honours the caller tone when the number IS measured', () => {
    render(<KpiCard label="Voice Success 24h" value="95.3%" tone="green" state="ok" />);

    expect(tile()).toHaveAttribute('data-tone', 'green');
    expect(tile().className).toContain('bg-tint-green');
    expect(screen.getByText('95.3%')).toBeInTheDocument();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('defaults to ok and to blue — the neutral-informational tone', () => {
    render(<KpiCard label="Active Farms" value={16} />);

    expect(tile()).toHaveAttribute('data-state', 'ok');
    expect(tile()).toHaveAttribute('data-tone', 'blue');
    expect(screen.getByText('16')).toBeInTheDocument();
  });

  it('keeps the delta green for up and red for down — the only two verdicts', () => {
    const { unmount } = render(<KpiCard label="Failures" value={3} delta="+3" deltaTrend="up" />);
    expect(screen.getByText('+3').className).toContain('text-green');
    unmount();

    render(<KpiCard label="Failures" value={3} delta="-3" deltaTrend="down" />);
    expect(screen.getByText('-3').className).toContain('text-red');
  });
});
