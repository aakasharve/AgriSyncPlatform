import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Disclosure } from '@/components/ui/Disclosure';
import { StandingNote } from '@/components/state';

/**
 * THE TEST THAT SEPARATES "COLLAPSED" FROM "DELETED".
 *
 * The founder asked for the long caveats on every screen to become
 * expandable. The rule the whole rebuild rests on is that the console never
 * claims more than it knows — so hiding a caveat behind a click is fine and
 * deleting one is not, and the difference between those two is invisible in a
 * screenshot, in a review, and in every other test in this repo.
 *
 * This file is what makes it visible. Every assertion below is about the
 * CLOSED state, because the closed state is the one that can silently become
 * a deletion.
 */

const CAVEAT =
  'This list is not scoped to an organisation, so the figure is platform-wide.';

describe('a closed disclosure hides its caveat — it does not drop it', () => {
  it('is closed on first render, and says so truthfully', async () => {
    render(
      <Disclosure label="What this screen cannot tell you" name="t">
        <p>{CAVEAT}</p>
      </Disclosure>
    );
    const button = screen.getByRole('button', { name: /what this screen cannot tell you/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('KEEPS THE WORDS IN THE DOM while closed', () => {
    /*
     * The load-bearing assertion in this file. `Disclosure` renders its
     * children unconditionally — there is no `{open && …}` in it — so a closed
     * caveat is a hidden region rather than an unmounted one. If someone
     * "optimises" that into a conditional render, the words leave the page and
     * this is the only thing that notices.
     */
    const { container } = render(
      <Disclosure label="Why?" name="t">
        <p>{CAVEAT}</p>
      </Disclosure>
    );
    expect(container.textContent).toContain(CAVEAT);
    expect(screen.getByText(CAVEAT)).toBeInTheDocument();
  });

  it('hides it with `until-found`, so Ctrl+F still finds it', () => {
    /*
     * `hidden` and `hidden="until-found"` are the same thing to a screen
     * reader and different things to find-in-page: the first makes a caveat
     * unfindable, the second lets the browser reveal it. A caveat you cannot
     * search for is most of the way to a caveat that is not there.
     */
    render(
      <Disclosure label="Why?" name="t">
        <p>{CAVEAT}</p>
      </Disclosure>
    );
    const region = document.getElementById(
      screen.getByRole('button').getAttribute('aria-controls')!
    );
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('hidden', 'until-found');
  });

  it('opens on click and on the keyboard, and aria-expanded follows', async () => {
    const user = userEvent.setup();
    render(
      <Disclosure label="Why?" name="t">
        <p>{CAVEAT}</p>
      </Disclosure>
    );
    const button = screen.getByRole('button');
    const region = () =>
      document.getElementById(button.getAttribute('aria-controls')!);

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(region()).not.toHaveAttribute('hidden');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');

    // A real <button>, so Enter and Space come free. Asserted because the
    // alternative — a div with onClick — looks identical on screen and is
    // unreachable without a mouse.
    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('points aria-controls at the region it actually controls', () => {
    render(
      <Disclosure label="Why?" name="t">
        <p>{CAVEAT}</p>
      </Disclosure>
    );
    const id = screen.getByRole('button').getAttribute('aria-controls');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).toHaveTextContent(CAVEAT);
  });

  it('shows the summary without a click, so the choice to open is informed', () => {
    render(
      <Disclosure label="What this screen cannot tell you" summary="Where these numbers come from." name="t">
        <p>{CAVEAT}</p>
      </Disclosure>
    );
    expect(screen.getByText('Where these numbers come from.')).toBeVisible();
  });
});

describe('StandingNote is the screen-foot form, and it is not NotMeasuredPanel', () => {
  it('folds shut, carries its words, and is announced as a control', () => {
    const { container } = render(<StandingNote why={<p>{CAVEAT}</p>} />);
    const button = screen.getByRole('button', { name: /what this screen cannot tell you/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(container.textContent).toContain(CAVEAT);
  });

  it('is NOT a live region — a fixed paragraph must not be announced on render', () => {
    /*
     * The old panel carried `role="status"` + `aria-live="polite"`, inherited
     * from `NotMeasuredPanel`, which needs it: that one appears IN PLACE OF
     * data when a fetch resolves, so it is genuinely a status. A standing note
     * never changes. A live region that reads two hundred fixed words on every
     * render is noise a screen-reader user cannot skip.
     */
    const { container } = render(<StandingNote why={<p>{CAVEAT}</p>} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it('keeps its title visible even when shut', () => {
    // The title is the caveat's headline. `/settings/admins` relies on this:
    // its note is titled "This screen is not permission-gated", and folding
    // THAT out of sight would be the one thing its own task forbade.
    render(<StandingNote title="This screen is not permission-gated" why={<p>{CAVEAT}</p>} />);
    expect(screen.getByText('This screen is not permission-gated')).toBeVisible();
  });
});
