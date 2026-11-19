import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleBootBoundary } from '../ConsoleBootBoundary';
import boundarySource from '../ConsoleBootBoundary.tsx?raw';
import appSource from '../../App.tsx?raw';

/**
 * THE BOOT-FAILURE STATE (Task 26 Step 7).
 *
 * Until this component there was NO error boundary anywhere in the console, and
 * every screen is a `lazy()` import. `<Suspense>` covers a chunk that is still
 * arriving and does nothing for one that never arrives — so a rejected dynamic
 * import, which is the ordinary consequence of a deploy while a console is
 * open, unmounted the tree and left an operator looking at white.
 *
 * White is indistinguishable from "the platform is fine and there is nothing to
 * show", which is the same collapse as "No errors found. The system is healthy."
 * over a 500.
 *
 * React logs a caught error to `console.error` regardless of the boundary, and
 * the component logs its own line as well. Both are silenced per test rather
 * than globally: an unexpected `console.error` from anything else in the suite
 * should still be visible.
 */

/** A component that throws the way a failed chunk import does. */
function Exploding(): never {
  throw new Error('Failed to fetch dynamically imported module: /assets/HomePage-a1b2.js');
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('a screen whose code did not load', () => {
  it('says so, says it is not a zero, and offers the one action that helps', () => {
    render(
      <ConsoleBootBoundary>
        <Exploding />
      </ConsoleBootBoundary>,
    );

    /* `role="alert"` rather than a quiet div: nothing else on the page is
       going to tell anyone. */
    const panel = screen.getByRole('alert');
    expect(panel).toHaveAttribute('data-boot-failure', 'console');
    expect(screen.getByText('This screen could not load its code')).toBeInTheDocument();

    /* THE SENTENCE THAT MATTERS, carried from the v3 prototype's own
       boot-failure block. A blank screen invites the reader to supply a
       reading, and the reading they supply is "fine". */
    expect(
      screen.getByText(/Nothing here is a zero and nothing here is healthy/),
    ).toBeInTheDocument();

    /* A stale chunk is fixed by a reload, and it is the only thing a person
       whose console has no working code can do. */
    expect(screen.getByRole('button', { name: 'Reload the console' })).toBeInTheDocument();

    /* What the browser actually said, verbatim, because "something went wrong"
       is not a fault report. */
    expect(screen.getByText(/Failed to fetch dynamically imported module/)).toBeInTheDocument();
  });

  it('renders its children untouched when nothing fails', () => {
    render(
      <ConsoleBootBoundary>
        <p>the console</p>
      </ConsoleBootBoundary>,
    );
    expect(screen.getByText('the console')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports the failure rather than swallowing it', () => {
    const seen: unknown[] = [];
    render(
      <ConsoleBootBoundary onError={(e) => seen.push(e)}>
        <Exploding />
      </ConsoleBootBoundary>,
    );
    expect(seen).toHaveLength(1);
    /* This console has no error-reporting sink — `/telemetry/client-error` is
       the FARMER app's and reads a farm claim no admin token carries — so the
       host log and the reader's own eyes are the whole of the signal. A
       boundary that caught the error and said nothing anywhere would be the
       swallow it exists to replace. */
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('it cannot itself be the thing that failed', () => {
  it('is imported statically by App.tsx, never lazily', () => {
    /* A boundary that has to be fetched cannot report a failed fetch. */
    expect(appSource).toContain(
      "import { ConsoleBootBoundary } from '@/app/ConsoleBootBoundary';",
    );
    expect(appSource).not.toMatch(/lazy\(\(\) => import\([^)]*ConsoleBootBoundary/);
    /* And it wraps the routes, so the SHELL is inside it too — the shell is as
       capable of failing as a page is. */
    expect(appSource).toContain('<ConsoleBootBoundary>');
    expect(appSource.indexOf('<ConsoleBootBoundary>')).toBeLessThan(
      appSource.indexOf('<Routes>'),
    );
  });

  it('draws its own icon and depends on no component that lives in a chunk', () => {
    /* The v3 prototype writes its SVG out by hand for this exact reason: "the
       icon is written out here rather than fetched from AS.icon, because AS is
       exactly what may be missing." */
    expect(boundarySource).toContain('<svg');
    expect(boundarySource).not.toContain("from 'lucide-react'");
    expect(boundarySource).not.toContain("from '@/components/state'");
    expect(boundarySource).not.toContain("from '@/components/ui/");
  });
});
