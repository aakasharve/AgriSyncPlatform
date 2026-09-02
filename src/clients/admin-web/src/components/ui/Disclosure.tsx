import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * DISCLOSURE — the one way this console hides a long explanation.
 *
 * ── Why it exists ────────────────────────────────────────────────────────
 * Thirty tasks added an honest caveat to every screen: what a list does not
 * carry, why a sort is not what you would expect, which feed is not scoped to
 * an organisation, what a column really counts. Every word of it is true and
 * most of it is not needed on first read, and the founder's note was exactly
 * that: *"on each screen alot of text is tehre just make it expandable when
 * user wants to know"*.
 *
 * 🛑 HIDING A CAVEAT BEHIND A CLICK IS FINE. DELETING ONE IS NOT.
 *
 * The rule the whole rebuild rests on is that the console never claims more
 * than it knows. This component is what makes "collapsed" different from
 * "gone", and it is built so that the difference is a property rather than a
 * promise:
 *
 *   1. THE CHILDREN ARE ALWAYS RENDERED. There is no `{open && …}` below.
 *      A closed disclosure is a hidden region, not an unmounted one, so the
 *      words are in the DOM, in the accessibility tree's flat text, in
 *      "Save as HTML", and in a screen-reader's read-all.
 *   2. `hidden="until-found"` RATHER THAN `hidden`. In a browser that
 *      supports it, Ctrl+F still finds text inside a closed disclosure and
 *      the browser opens it to show the reader where the match is — so a
 *      caveat cannot be lost by being closed. In a browser that does not, the
 *      attribute is just `hidden`, which is the correct fallback. The
 *      `beforematch` listener below is what keeps React's state in step when
 *      the browser opens it.
 *   3. `aria-expanded` IS THE REAL STATE, never a guess.
 *
 * ── Why one component and not `<details>` ────────────────────────────────
 * `<details>`/`<summary>` is the obvious answer and it was measured against
 * this: it cannot hold `hidden="until-found"` on its body, its open state is
 * a DOM attribute rather than React state (so nothing else on the screen can
 * respond to it), and `<summary>` resists layout — a two-line label with an
 * icon and a chevron fights the marker in every browser. The behaviour here
 * is thirty lines and is the same behaviour everywhere, which is the point:
 * the affordance has to be LEARNABLE. One shape, one place, on every screen.
 *
 * ── Keyboard ─────────────────────────────────────────────────────────────
 * It is a real `<button>`. Enter and Space come free, focus comes free, and
 * the global focus ring in globals.css draws it. Nothing here re-implements
 * any of that, which is why there is no `onKeyDown` below.
 */

export interface DisclosureProps {
  /** The always-visible label. "What this screen cannot tell you", "Why?" */
  label: ReactNode;
  /**
   * ONE PLAIN SENTENCE, ALWAYS VISIBLE, saying what is inside.
   *
   * A closed disclosure labelled only "Why?" asks the reader to gamble a
   * click. This is what makes the choice informed, and it is the reason the
   * collapsed state is not a loss of information: the headline stays on the
   * screen and the detail moves one key away.
   */
  summary?: ReactNode;
  /** The badge glyph. Defaults to none. */
  icon?: ReactNode;
  /**
   * `panel` — a glass card. For the standing note at the foot of a screen.
   * `inline` — a quiet text control. For a caveat that belongs beside the
   *            thing it qualifies, inside a panel that already exists.
   */
  variant?: 'panel' | 'inline';
  /** Open on first render. Default false — the whole point is "closed". */
  defaultOpen?: boolean;
  /** Lands on the DOM so tests assert the contract, not a class string. */
  name?: string;
  children: ReactNode;
  className?: string;
}

export function Disclosure({
  label,
  summary,
  icon,
  variant = 'panel',
  defaultOpen = false,
  name,
  children,
  className,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = `${useId()}-region`;
  const region = useRef<HTMLDivElement>(null);

  /*
   * `beforematch` fires when find-in-page is about to reveal something inside
   * a `hidden="until-found"` subtree. Without this listener the browser would
   * show the text while `aria-expanded` still said "false" and the chevron
   * still pointed down — the control lying about its own state, which is the
   * one thing a disclosure must never do.
   *
   * It is attached by ref rather than as a React prop because React has no
   * `onBeforeMatch`.
   */
  useEffect(() => {
    const el = region.current;
    if (!el) return;
    const reveal = () => setOpen(true);
    el.addEventListener('beforematch', reveal);
    return () => el.removeEventListener('beforematch', reveal);
  }, []);

  /*
   * 🛑 THE `until-found` UPGRADE, AND WHY IT IS NOT A JSX PROP.
   *
   * React types `hidden` as a boolean and coerces any truthy value to the
   * empty string, so `hidden="until-found"` written in JSX renders as plain
   * `hidden=""` — measured, not assumed; the first version of this component
   * did exactly that and the test caught it. Plain `hidden` is correct for a
   * screen reader and WRONG for find-in-page: Ctrl+F cannot see into it, so a
   * closed caveat becomes an unsearchable one, which is most of the way to a
   * caveat that is not there.
   *
   * So React still renders `hidden={!open}` below — which means the region is
   * hidden in the very first paint, with no flash of open content — and this
   * layout effect upgrades the VALUE before the browser paints. React never
   * reads the DOM back, so it does not fight the upgrade; when `open` goes
   * true React removes the attribute outright and there is nothing left to
   * upgrade.
   */
  useLayoutEffect(() => {
    const el = region.current;
    if (el && !open) el.setAttribute('hidden', 'until-found');
  }, [open]);

  const panel = variant === 'panel';

  return (
    <div
      data-disclosure={name ?? ''}
      data-open={open ? '' : undefined}
      {...(panel ? { 'data-print': 'panel' } : {})}
      className={cn(
        panel ? 'glass-panel overflow-hidden rounded-panel' : 'flex flex-col gap-2',
        className
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'group flex w-full items-center gap-3 text-left transition-colors',
          panel
            ? 'px-5 py-4 hover:bg-wash'
            : 'rounded-chip px-2 py-1 text-caption font-semibold text-blue hover:bg-wash'
        )}
      >
        {panel && icon && (
          <span
            aria-hidden="true"
            className="grid size-10 flex-none place-items-center rounded-chip bg-tint-grey text-text-2"
          >
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block',
              panel ? 'text-h3 font-semibold text-text-1' : 'underline underline-offset-2'
            )}
          >
            {label}
          </span>
          {summary && panel && (
            <span className="mt-0.5 block max-w-[var(--text-measure)] text-caption text-text-2">
              {summary}
            </span>
          )}
        </span>
        <ChevronDown
          size={panel ? 20 : 16}
          aria-hidden="true"
          className={cn(
            'flex-none text-text-2 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {/* ALWAYS RENDERED. See property (1) in the header — this is the line
          that makes a collapsed caveat different from a deleted one. */}
      <div
        id={regionId}
        ref={region}
        hidden={!open}
        className={cn(panel && 'border-t border-line px-5 pt-4 pb-5')}
      >
        <div
          className={cn(
            'flex max-w-[var(--text-measure)] flex-col gap-3 text-body',
            panel ? 'text-text-2' : 'text-text-2'
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
