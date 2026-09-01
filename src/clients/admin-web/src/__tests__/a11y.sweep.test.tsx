import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandPalette } from '@/app/CommandPalette';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * TASK 29 — THE ACCESSIBILITY AND RESPONSIVENESS SWEEP, AS AN EXECUTABLE.
 *
 * The primitives already have behavioural tests: `DataList.test.tsx` proves a
 * row opens on Enter AND Space and that `aria-sort` is live, `honestStates.
 * test.tsx` proves `LoadingState` is a named busy region, `ChartShell.test.tsx`
 * proves the data table renders. None of that is what Task 29 asks for.
 *
 * Task 29 asks whether the property holds ON EVERY SCREEN — thirteen of them,
 * built by thirteen different tasks — and that is a question about CALL SITES,
 * not about components. A primitive that gets it right and one screen that
 * hand-rolls its own version is exactly the failure a component test cannot
 * see. So most of this file is a static sweep over every source file, and it
 * is written to go red when a FOURTEENTH screen forgets.
 *
 * The two behavioural blocks at the end are here because no static read can
 * answer them: whether the modal actually keeps the keyboard, and whether it
 * gives it back.
 */

/** Every first-party source file, minus the tests — the same shape the token
 *  contract uses, and for the same reason: a test that asserts on a banned
 *  string must not report itself. */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('/src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ).filter(([path]) => !/\.test\.tsx?$/.test(path)),
);

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;

/** What a file DECLARES, never what its prose mentions. Every "must not
 *  contain" assertion below runs against this, so a component explaining why
 *  it does not remove an outline cannot fail the rule that says so. */
const declared = (source: string) => source.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');

const CODE: Record<string, string> = Object.fromEntries(
  Object.entries(SOURCES).map(([path, source]) => [path, declared(source)]),
);

/** The sweep is only evidence if it actually read the console. */
it('read every source file — not an empty glob', () => {
  expect(Object.keys(CODE).length).toBeGreaterThan(80);
  expect(CODE['/src/app/AdminShell.tsx']).toContain('data-print="chrome"');
});

/** Files whose declarations contain a pattern, as `path — matched text`, so a
 *  failure names the file AND the line rather than only the count. */
function offenders(pattern: RegExp): string[] {
  return Object.entries(CODE).flatMap(([path, source]) =>
    [...source.matchAll(pattern)].map((m) => `${path} — ${m[0].trim()}`),
  );
}

/* ══════════════════════════════════ STEP 1 — the keyboard ══════════════ */

describe('Step 1 — nothing in this console removes a focus outline', () => {
  /**
   * The token contract already asserts this for the three UI primitives. It
   * was never true of the console: four inputs carried `outline-none` —
   * `CommandPalette`, `FarmerSearchBox` and both `LoginPage` fields — and
   * they were INERT, which is worse than wrong.
   *
   * `:focus-visible` is declared unlayered in `globals.css`, and an unlayered
   * declaration outranks every `@layer utilities` rule Tailwind emits
   * regardless of specificity. So the ring was drawn anyway and the four
   * utilities described a behaviour the stylesheet was overriding — a line
   * that looks deliberate, reads as a §10 violation, and stops being harmless
   * the day someone moves the ring into a layer.
   *
   * Deleting them changed no pixel (verified: the cascade already won) and
   * made the rule true at the call site as well as in the stylesheet.
   */
  it('declares no outline-none, outline-0 or outline: none anywhere in src', () => {
    expect(offenders(/\boutline-none\b|\boutline-0\b|outline:\s*none/g)).toEqual([]);
  });
});

describe('Step 1 — every expandable row comes from the one component', () => {
  /**
   * `ExpandableRow` handles Enter AND Space, both with `preventDefault`, and
   * carries `aria-expanded` + `aria-controls`. `DataList.test.tsx` proves that.
   * What THIS asserts is that no screen quietly grew a second one: a `<tr>`
   * made focusable anywhere else is a row whose keyboard contract nobody has
   * tested.
   */
  it('is the only file that makes a table row focusable', () => {
    const rowsWithTabIndex = Object.entries(CODE)
      .filter(([, source]) => /<tr[^>]*tabIndex/s.test(source) || /'tabIndex'/.test(source))
      .map(([path]) => path);

    expect(rowsWithTabIndex).toEqual(['/src/components/data/ExpandableRow.tsx']);
  });

  it('and it is the only file that handles a keypress on a row', () => {
    expect(CODE['/src/components/data/ExpandableRow.tsx']).toContain("e.key !== 'Enter'");
    expect(CODE['/src/components/data/ExpandableRow.tsx']).toContain("e.key !== ' '");
    expect(CODE['/src/components/data/ExpandableRow.tsx']).toContain('e.preventDefault()');
  });
});

/* ═══════════════════════════ STEP 2 — the screen reader ═══════════════ */

describe('Step 2 — every chart carries its data table (A32)', () => {
  /**
   * `ChartShell` makes `dataTable` a required prop, so this cannot fail while
   * `tsc -b` passes — which is exactly why it is asserted rather than assumed.
   * The register line the founder signs says "every chart has its data table",
   * and the thing that makes that true is that every chart goes THROUGH the
   * shell. A screen that renders `<ResponsiveContainer>` directly would keep
   * the build green and lose the table.
   */
  it('renders no recharts container outside ChartShell', () => {
    const direct = Object.entries(CODE)
      .filter(([path]) => path !== '/src/components/data/ChartShell.tsx')
      .filter(([, source]) => source.includes('ResponsiveContainer'))
      .map(([path]) => path);

    expect(direct).toEqual([]);
  });

  it('passes dataTable at every ChartShell call site', () => {
    const callSites = Object.entries(CODE).filter(([, s]) => s.includes('<ChartShell'));
    expect(callSites.length).toBeGreaterThan(0);

    for (const [path, source] of callSites) {
      const opens = (source.match(/<ChartShell/g) ?? []).length;
      const tables = (source.match(/\bdataTable=/g) ?? []).length;
      expect(`${path}: ${opens} charts, ${tables} tables`).toBe(
        `${path}: ${opens} charts, ${opens} tables`,
      );
    }
  });
});

describe('Step 2 — every loading block is NAMED', () => {
  /**
   * `label` has a default, deliberately, so a component cannot fail to render.
   * A page with five panels loading at once and five identical "loading"
   * announcements is the same as none, so the default is a backstop and never
   * a house style — and this is what stops it becoming one.
   */
  it('passes an explicit label at every LoadingState call site', () => {
    const callSites = Object.entries(CODE).filter(
      ([path, s]) => s.includes('<LoadingState') && path !== '/src/components/state/LoadingState.tsx',
    );
    expect(callSites.length).toBeGreaterThan(0);

    for (const [path, source] of callSites) {
      const uses = (source.match(/<LoadingState/g) ?? []).length;
      const labelled = (source.match(/<LoadingState\s+label=/g) ?? []).length;
      expect(`${path}: ${uses} blocks, ${labelled} named`).toBe(
        `${path}: ${uses} blocks, ${uses} named`,
      );
    }
  });

  it('names DataList’s own two loading blocks from the list’s label', () => {
    const list = CODE['/src/components/data/DataList.tsx'];
    expect([...list.matchAll(/aria-busy="true"/g)]).toHaveLength(2);
    expect([...list.matchAll(/aria-label=\{`Loading \$\{label\}`\}/g)]).toHaveLength(2);
  });
});

describe('Step 2 — aria-sort and aria-expanded are computed, never asserted', () => {
  /**
   * A hardcoded `aria-sort="ascending"` is a screen telling a screen-reader
   * user which column the list is ordered by, in a string that cannot change
   * when the order does. Only `SortHeader` may emit the attribute, and it
   * emits it from the live sort state.
   */
  it('leaves aria-sort to SortHeader alone', () => {
    const emitters = Object.entries(CODE)
      .filter(([, s]) => s.includes('aria-sort'))
      .map(([path]) => path);

    expect(emitters).toEqual(['/src/components/data/SortHeader.tsx']);
  });

  /**
   * ONE literal `aria-expanded` survives, and it is truthful: the palette's
   * combobox owns a listbox that is rendered for as long as the dialog is,
   * empty results included. Every other site is bound to state.
   */
  it('binds aria-expanded to state everywhere except the palette’s always-open listbox', () => {
    const literals = offenders(/aria-expanded="(?:true|false)"/g);
    expect(literals).toEqual(['/src/app/CommandPalette.tsx — aria-expanded="true"']);

    const palette = CODE['/src/app/CommandPalette.tsx'];
    // The listbox it claims is expanded is not conditional on there being rows.
    expect(palette).toContain('<div id={listId} role="listbox"');
    expect(palette).not.toMatch(/shown\.length > 0 &&\s*<div id=\{listId\}/);
  });
});

describe('Step 2 — a coloured dot never speaks alone', () => {
  /**
   * Two components in this console encode a state as a dot. Colour is not a
   * reading: it is invisible to a screen reader and ambiguous to the 8% of
   * men who cannot separate the red one from the green one. Both carry the
   * finding in words, and both hide the dot from the accessibility tree so
   * the words are not announced twice.
   */
  it('Home’s section dot is aria-hidden and paired with the finding in words', () => {
    const home = CODE['/src/pages/HomePage.tsx'];
    expect(home).toMatch(/data-section-dot=\{state\}\s*\n\s*aria-hidden="true"/);
    expect(home).toContain('<span className="sr-only">{words}</span>');
    // `words` is REQUIRED alongside a state — a dot with no sentence cannot
    // type-check, which is the guard this assertion stands over.
    expect(home).toContain('words: string | null;');
  });

  it('the freshness chip’s dot always sits beside a source and an age', () => {
    const chip = CODE['/src/components/ui/FreshnessChip.tsx'];
    expect(chip).toContain('<span className="dot" />');
    expect(chip).toMatch(/\{label\}/);
    expect(chip).toContain("const NO_AGE = 'age not reported'");
  });
});

/* ═════════════════════════════ STEP 3 — responsiveness ════════════════ */

describe('Step 3 — the shell answers 1280, 1279 and 1023', () => {
  /**
   * Task 3 removed the fixed `width=1280` viewport and EXPLICITLY DEFERRED the
   * sidebar collapse to Task 10. This is where that deferral is checked rather
   * than assumed — the exact shape of thing that gets ticked twice and built
   * never.
   *
   * Tailwind's `lg` is 1024px and `xl` is 1280px, so the three widths the plan
   * names are:
   *   >= 1280  the full 236px column   (`xl:grid-cols-[var(--spacing-sidebar)…]`)
   *   1024–1279 a 212px column          (`lg:grid-cols-[…-narrow)…]`)
   *   <= 1023  no column at all — `grid-cols-1`, and the aside becomes a
   *            horizontal strip above the content (`flex-wrap`, `lg:flex-col`).
   */
  const shell = () => CODE['/src/app/AdminShell.tsx'];

  it('gives the sidebar three widths, all from tokens and none from a literal', () => {
    expect(shell()).toContain('grid-cols-1');
    expect(shell()).toContain('lg:grid-cols-[var(--spacing-sidebar-narrow)_minmax(0,1fr)]');
    expect(shell()).toContain('xl:grid-cols-[var(--spacing-sidebar)_minmax(0,1fr)]');
    expect(shell()).not.toMatch(/grid-cols-\[\d+px/);
  });

  it('turns the column into a horizontal strip below lg', () => {
    // `flex-wrap` is the strip; `lg:flex-col` is the column. Losing either one
    // gives a sidebar that overflows a narrow screen instead of wrapping.
    expect(shell()).toContain('flex flex-wrap items-center');
    expect(shell()).toContain('lg:flex-col');
    expect(shell()).toContain('lg:flex-nowrap');
  });

  it('keeps the main pane from being squeezed to nothing by its own content', () => {
    // `minmax(0,1fr)` in both templates and `min-w-0` on the pane. Without
    // them a wide table pushes the grid past the viewport and the sidebar
    // scrolls off the left edge — the classic CSS-grid overflow.
    expect(shell()).toContain('flex min-w-0 flex-col');
  });
});

/* ═══════════════════════ STEP 4 — reduced motion and print ════════════ */

describe('Step 4 — the print rule has something to hide', () => {
  /**
   * `globals.css` hides `[data-print="chrome"]` and the token contract asserts
   * the rule exists. A rule with no matching element is the failure this
   * catches: BOTH pieces of chrome must carry the attribute, or a printed
   * console still shows a sidebar it cannot navigate.
   */
  it('marks both the sidebar and the top bar as chrome', () => {
    expect([...CODE['/src/app/AdminShell.tsx'].matchAll(/data-print="chrome"/g)]).toHaveLength(2);
  });

  it('and no component opts itself out of prefers-reduced-motion', () => {
    // The stylesheet's rule is `*` with `!important`. A component setting an
    // inline `animation` or `transition` style would beat it.
    expect(offenders(/style=\{\{[^}]*(?:animation|transitionDuration)[^}]*\}\}/g)).toEqual([]);
  });
});

/* ═══════════════════ the two things a static read cannot answer ═══════ */

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
});

function stubScope() {
  return installAdapter(async (req) => {
    if (req.url.includes('/admin/me/scope')) {
      return {
        status: 200,
        data: {
          outcome: 'Resolved',
          scope: {
            userId: '00000000-0000-0000-0000-0000000000aa',
            orgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            orgType: 'FPO',
            orgRole: 'Owner',
            isPlatformAdmin: false,
            modules: [],
          },
          memberships: [],
        },
      };
    }
    return { status: 200, data: { data: [], meta: {} } };
  });
}

async function openPalette() {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  return screen.findByRole('dialog', { name: 'Search the console' }, { timeout: 5_000 });
}

describe('Step 1 — the palette keeps the keyboard, and gives it back', () => {
  /**
   * `aria-modal="true"` is a PROMISE that nothing outside the dialog is
   * reachable. Until Task 29 the palette made it and did not keep it: Tab
   * walked out into the shell underneath, which is still rendered, still
   * focusable, and now behind a backdrop a keyboard user cannot see.
   *
   * The return half is the half that is usually skipped, and it is the one an
   * operator feels: open the palette, change your mind, press Escape — and
   * the next Tab used to restart from the top of the console instead of from
   * where they were.
   */
  function setup() {
    stub = stubScope();
    const { container } = renderWithProviders(
      <>
        <button type="button" data-testid="opener">
          Where the operator was
        </button>
        <CommandPalette />
      </>,
    );
    return container;
  }

  it('wraps Tab from the last focusable back to the first', async () => {
    setup();
    const opener = screen.getByTestId('opener');
    opener.focus();

    const dialog = await openPalette();
    const focusables = [...dialog.querySelectorAll<HTMLElement>('input, button, a[href]')];
    expect(focusables.length).toBeGreaterThan(1);

    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });

    expect(document.activeElement).toBe(focusables[0]);
  });

  it('wraps Shift+Tab from the first focusable back to the last', async () => {
    setup();
    const dialog = await openPalette();
    const focusables = [...dialog.querySelectorAll<HTMLElement>('input, button, a[href]')];

    focusables[0].focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(focusables[focusables.length - 1]);
  });

  it('returns focus to whatever had it when the palette closes', async () => {
    setup();
    const opener = screen.getByTestId('opener');
    opener.focus();
    expect(document.activeElement).toBe(opener);

    await openPalette();
    // `autoFocus` moved the keyboard into the search box.
    expect(document.activeElement).toBe(within(screen.getByRole('dialog')).getByRole('combobox'));

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Search the console' })).toBeNull(),
    );
    expect(document.activeElement).toBe(opener);
  });

  it('leaves an unrelated key alone — the trap is Tab and nothing else', async () => {
    setup();
    const dialog = await openPalette();
    const combobox = within(dialog).getByRole('combobox');
    combobox.focus();

    fireEvent.keyDown(dialog, { key: 'a' });

    expect(document.activeElement).toBe(combobox);
  });
});
