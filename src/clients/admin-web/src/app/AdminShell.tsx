import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Check,
  ChevronDown,
  LogOut,
  RefreshCw,
  Search,
  User as UserIcon,
} from 'lucide-react';
import { useAdminAuth } from './AdminAuthProvider';
import { useActiveOrg } from './ActiveOrgProvider';
import { GROUP_ORDER, NAV, type NavGroup } from './nav';
import { useNavBadges } from './navBadges';
import { ToastHost } from './ToastHost';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { PersonName } from '@/components/ui/PersonName';
import { useAdminScope } from '@/hooks/useAdminScope';
import { decodeJwt } from '@/lib/auth';
import { cn } from '@/lib/utils';

/**
 * THE SHELL — the frame around every screen in the console.
 *
 * Rebuilt on the v3 layout and the Task 3 token layer. Four things changed
 * that a founder will see, and each is a decision rather than a redraw:
 *
 *  1. THE ACTIVE ORGANIZATION IS NOW NAMED ON EVERY SCREEN (register A39).
 *     It used to appear in exactly one subtitle on one screen
 *     (FarmerHealthPage.tsx:31-33,55-57). The v3 prototype has no org concept
 *     at all — a grep of all thirteen files returns zero hits for org, tenant
 *     or scope — so a faithful port would have deleted the last visible trace
 *     of tenancy and left every screen showing org-scoped numbers with
 *     nothing on screen saying WHICH org. The v3 doctrine's own rule is that
 *     a number must state its scope, and "whose farms am I looking at" is the
 *     largest scope there is.
 *  2. THE THREE SHORTCUT BADGES ARE GONE (D4, founder 2026-08-31). The
 *     sidebar advertised Cmd-1, Cmd-2 and Cmd-F. The only global key handler
 *     in the codebase binds Cmd-K and Escape (CommandPalette.tsx:39-49), so
 *     those three chips described behaviour that has never existed. The
 *     Cmd-K hint stays, because Cmd-K is real.
 *  3. THE AVATAR IS THE SIGNED-IN ADMIN (D12). It used to call
 *     `initialsOf(null, null)`, so every user in every org saw the same two
 *     letters, and `useAdminAuth()` was called and its result thrown away.
 *     The console never showed who was signed in.
 *  4. THERE IS A SIGN-OUT CONTROL (B3) AND A REFRESH CONTROL (B14). Until
 *     now the ONLY sign-out in the entire application was on the /403 page —
 *     a signed-in admin on a working screen had no way out. /403 keeps its
 *     own; a denied user still needs it.
 *
 * The wheat shader that used to sit behind all of this (D3) was deleted in
 * Task 3 with dark mode, which is why nothing here positions itself above it.
 */

/**
 * THE DESTINATIONS MOVED TO `./nav.ts` IN TASK 13, and it is worth one line
 * to say why rather than leaving a reader to find them.
 *
 * The command palette kept a SECOND hardcoded list of the same screens, and
 * the two had already drifted: Farmer Health was in this sidebar and missing
 * from the palette entirely. `nav.ts` is now the one statement of "these are
 * the screens this console has", it carries each route's module key so the
 * palette can filter by permission, and the `badge` slot (Preservation
 * Register A53) and the six-group ordering moved with it.
 */

/**
 * The keyboard the admin is actually sitting at. The palette binds metaKey OR
 * ctrlKey (CommandPalette.tsx:40), so the hint printed the Apple glyph to
 * every Windows operator — a small lie of exactly the D4 shape, in the one
 * hint that survived D4.
 */
/**
 * THE SIX SECTION ACCENTS — added 2026-09-02, and the distinction they rest
 * on is worth stating where a reader will meet it.
 *
 * Task 10 STRIPPED the per-ITEM icon colours, and that judgement was right:
 * a green Home icon beside a blue Users icon encoded nothing. Nothing about
 * Home is green. The colour was decoration wearing a meaning's clothes, and
 * CONTRACT.md §7.7's rule is "if you cannot say what a colour means, remove
 * it."
 *
 * A SECTION colour survives that test where an item colour did not, because
 * it says something true and useful: WHERE YOU ARE. Six groups, six accents,
 * on the group heading and on the active item inside it — so the answer to
 * "which part of the console am I in" is legible from the corner of the eye
 * rather than by reading a label.
 *
 * 🛑 WHAT THIS IS NOT. It is not a verdict. These six live only on the
 * navigation plane, which carries no readings; the four signal hues live only
 * on data surfaces, which the sidebar is not. An accent can therefore never
 * be mistaken for a measurement, because the two never appear on the same
 * surface. The one exception is deliberate and goes the other way: `NavBadge`
 * below is a READING — farms needing a person today — so it keeps §A.6's
 * `tint-red`/`red` and takes no accent at all.
 *
 * Every value is measured against BOTH the plane (`--color-nav`) and the
 * active pill (`--color-nav-raise`) in globals.css §A.11. Worst pair in the
 * set: 4.91:1. All twelve clear AA.
 */
const GROUP_ACCENT: Record<NavGroup, string> = {
  Overview: 'text-nav-overview',
  Operations: 'text-nav-operations',
  Product: 'text-nav-product',
  Farms: 'text-nav-farms',
  Schedules: 'text-nav-schedules',
  Admin: 'text-nav-admin',
};

const IS_APPLE =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

export function AdminShell() {
  const location = useLocation();
  const crumb = humanizePath(location.pathname);

  /* A53 — the badge slot has been styled and empty since Task 10. This is
     where it stops being empty. The shell asks for numbers keyed by route and
     learns nothing else; see `navBadges.ts` for what fills it and what it
     costs. A route with no computed badge falls back to the static `n.badge`,
     which nothing sets today and which stays for the same reason it always
     has: a declared slot is harder to delete by accident than an absent one. */
  const badges = useNavBadges();

  return (
    /* 1280 is the design width and gets the full 236px sidebar; 1024-1279
       narrows it to 212px; below 1024 the sidebar stops being a column and
       becomes a horizontal strip above the content. All three widths come
       from the token layer (globals.css §A.9), never from a literal. */
    <div className="grid min-h-screen grid-cols-1 lg:h-screen lg:grid-cols-[var(--spacing-sidebar-narrow)_minmax(0,1fr)] xl:grid-cols-[var(--spacing-sidebar)_minmax(0,1fr)]">
      <aside
        /* Task 3's print rule hides [data-print="chrome"]: a printed console
           is evidence, so the navigation goes and the content stays. */
        data-print="chrome"
        aria-label="Sections"
        /* THE NAVIGATION PLANE IS MINT GLASS (2026-09-02).

           It was #0e3a2b — a deep-green column down the left of every
           screen. The founder's note was "the overall colour theme is too
           dark", and this was the thing he meant: it is the single largest
           block of colour in the console. It is now a frosted, brand-tinted
           pane. The brand did not leave; it stopped being a dark field.

           WHY THIS IS STILL NOT DARK MODE, AND WAS NOT BEFORE. D1 dropped a
           mode that repaints the whole console from an OS preference,
           including every data surface. Nothing here reads a preference and
           nothing here is a data surface. Every panel, tile and figure is
           unchanged.

           EVERY TEXT COLOUR ON THIS PLANE IS MEASURED AGAINST ITS COMPOSITE
           rather than against white: the pane resolves to #d6eee3 over the
           page ground, the idle label reads 8.02:1 on it, and the worst of
           the six section accents reads 4.72:1 on the active pill.
           globals.css §A.11 carries all twelve figures. */
        className="glass-nav flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 lg:h-screen lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-0 lg:overflow-y-auto lg:px-4 lg:pt-6 lg:pb-8"
      >
        <div className="mr-3 flex items-center gap-3 lg:mr-0 lg:mb-5 lg:border-b lg:border-nav-line lg:px-2 lg:pb-5">
          {/* THE MARK NEEDS ITS OWN GROUND — carried from the farmer app, not
              rediscovered. `logo-mark.webp` is a GREEN shield with a dark green
              outline. mobile-web's FarmNameBoard records that placing it
              straight onto a green ground made the outline vanish and the
              farmer saw a smudge; the founder caught it on the built screen.
              The fix there was a cream disc with a brass ring.
              This sidebar is a frosted MINT pane, so it is the same hazard.
              The disc is what makes the logo legible; it is not decoration and
              must not be dropped. */}
          <span
            className="grid size-10 flex-none place-items-center rounded-full"
            style={{
              background: 'var(--color-mark-disc)',
              boxShadow: '0 0 0 1.5px var(--color-mark-ring), var(--shadow-surface)',
            }}
          >
            <img
              src="/brand/logo-mark.webp"
              alt=""
              aria-hidden="true"
              width={26}
              height={26}
              loading="eager"
              decoding="async"
              className="size-[26px] object-contain"
            />
          </span>
          <span className="leading-tight">
            {/* The product is Shram Safal; this console lives at
                admin.shramsafal.in. It said "AgriSync" — the platform — until
                2026-09-02. */}
            <span className="block text-h3 font-bold text-text-1">Shram Safal</span>
            <span className="block text-caption text-nav-muted">Admin console</span>
          </span>
        </div>

        {GROUP_ORDER.map((group) => {
          const items = NAV.filter((n) => n.group === group);
          if (items.length === 0) return null;
          const accent = GROUP_ACCENT[group];
          return (
            <div key={group} className="flex items-center gap-1 lg:mb-4 lg:block">
              <div
                className={cn(
                  'px-1 text-eyebrow font-bold uppercase lg:px-2 lg:pb-1.5',
                  accent
                )}
              >
                {group}
              </div>
              {items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  /* A58 — without `end`, Home matches every route and the
                     sidebar reports two current screens at once. */
                  end={n.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-chip px-3 py-2 text-body font-medium transition-colors lg:mb-1',
                      /* The active item is a TINTED PILL, not an underline and
                         not a left bar (CONTRACT.md §2) — unchanged. What
                         changed is the tint: the pill is the plane one step
                         lighter and the LABEL takes the section accent, so
                         the sidebar says which group you are in as well as
                         which screen. Nothing else in the sidebar is tinted,
                         so there is only ever one. */
                      isActive
                        ? cn('bg-nav-raise font-semibold', accent)
                        : 'text-nav-text hover:bg-nav-raise hover:text-text-1'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={cn('grid flex-none', isActive ? accent : 'text-nav-muted')}>
                        <n.Icon size={18} aria-hidden="true" />
                      </span>
                      <span className="hidden sm:inline">{n.label}</span>
                      <NavBadge count={badges[n.to] ?? n.badge} label={n.label} />
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </aside>

      {/* THE CONTENT COLUMN IS THE SCROLLER, not the <main> inside it, and that
          is what makes the top bar's frost mean something: a sticky element in
          a scrolling flow keeps its box and the content that follows it slides
          UNDERNEATH. With the scroll on <main>, the bar sat above a box that
          never passed beneath it and the blur had nothing to bend but the page
          ground. */}
      <div className="flex min-w-0 flex-col lg:h-screen lg:overflow-y-auto">
        <header
          data-print="chrome"
          /* GLASS, AND STICKY, SO IT HAS SOMETHING TO FROST. A translucent
             bar over a bar-height slice of nothing is just a paler bar; the
             effect exists because content slides underneath it. That is why
             the scroll moved up to the column wrapper above — see the note
             there. It is one change, not two. */
          className="glass-chrome sticky top-0 z-20 flex h-[var(--spacing-topbar)] flex-none items-center gap-3 px-5 xl:px-8"
        >
          {/* The breadcrumb now reads as a heading rather than as a caption.
              It is the only thing on the bar that says which screen this is,
              and at 15px medium in the caption grey it was the quietest text
              in the frame. */}
          <span className="hidden text-h3 font-semibold text-text-1 sm:inline">
            {crumb}
          </span>
          <OrgScope />
          <div className="ml-auto flex items-center gap-3">
            <ScreenRefresh />
            <span className="glass-quiet hidden items-center gap-2 rounded-chip px-2.5 py-1 text-caption text-text-2 md:inline-flex">
              <Search size={14} aria-hidden="true" />
              {/* Cmd-K and Escape are the only global bindings that exist
                  (CommandPalette.tsx:39-49). This is a HINT and not a button:
                  the palette has no imperative open API today, and a chip that
                  looks clickable and does nothing is the same defect D4 just
                  removed from the sidebar. T13 rewrites the palette and can
                  make this a real control. */}
              <kbd className="font-semibold text-text-1">{IS_APPLE ? '⌘K' : 'Ctrl K'}</kbd>
            </span>
            <SignedIn />
          </div>
        </header>

        {/* More air again, because everything inside it got bigger again. A
            34px page title and a 56px KPI figure inside 24px gutters read as
            cramped rather than as confident. */}
        <main className="min-h-0 flex-1 px-5 pt-8 pb-24 xl:px-10">
          <Outlet />
        </main>
      </div>

      {/* B15 — the slot every write surface will land in. Mounted, empty, and
          registering nothing; ToastHost.tsx says why it is mounted early. */}
      <ToastHost />
    </div>
  );
}

/**
 * The active organization, named, on every screen — plus the switcher the
 * console has promised since W0-B. `App.tsx:82` already tells a multi-org
 * admin "you can switch later from the topbar"; until now there was no topbar
 * switcher, and the only way to change org mid-session was to hand-edit
 * `?org=` in the address bar (register B11).
 *
 * WHICH ORG THIS NAMES. The id comes from the RESOLVED SCOPE first and the
 * ActiveOrgProvider selection second. That order matters and is not a
 * preference: a single-membership admin never picks an org, so `activeOrgId`
 * is null for them while the server has resolved them into their one
 * organization perfectly well. Reading the selection alone — which is what
 * `FarmerHealthPage.tsx:33` does today — prints "No active organization" to
 * an admin who plainly has one.
 *
 * WHERE THE URL COMES INTO IT. Nothing here reads the address bar; it reads
 * the provider. Task 12 moved the provider's own `?org=` write onto the
 * router's search params, so switching organisation here updates the url the
 * router can see, and a filter change on the screen underneath no longer
 * strips it back out.
 */
/**
 * THE BADGE, WITH A WORD BESIDE THE NUMBER.
 *
 * A bare number in a red pill beside "Home" says nothing to a screen-reader
 * user and very little to anyone else — "12" next to Home is a quantity of
 * an unnamed thing. The digits are what a sighted reader scans; the sentence
 * is what everyone else gets, and it names WHICH number this is.
 *
 * `undefined` renders nothing. That is the whole of the "disappears when there
 * is nothing to report" rule, and it covers three different truths on purpose
 * — no rows, no entitlement, and no answer yet — because none of the three
 * is a zero and a pill has no room to tell them apart. The count of zero is a
 * finding, and it belongs on the screen the badge points at, where there is
 * room to say "checked at 11:41 against both watchlists".
 */
function NavBadge({ count, label }: { count: number | undefined; label: string }) {
  if (typeof count !== 'number') return null;
  return (
    <span
      data-nav-badge={label}
      /* 🛑 THE ONE THING IN THE SIDEBAR THAT IS NOT CHROME, so it is the one
         thing that did NOT take a section accent. This is a READING — farms
         needing a person today — and §A.6's `tint-red` on `red` is what a
         reading that needs a person is drawn in everywhere else in the
         console. It keeps that pairing exactly, on the dark plane as on a
         white one, because a count means the same thing wherever it is
         printed. */
      className="ml-auto rounded-full bg-tint-red px-2 text-caption font-bold text-red"
    >
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">
        {count} {count === 1 ? 'farm needs' : 'farms need'} a person today
      </span>
    </span>
  );
}

function OrgScope() {
  const { scope, memberships } = useAdminScope();
  const { activeOrgId, setActiveOrgId } = useActiveOrg();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const currentOrgId = scope?.orgId ?? activeOrgId;
  const current = memberships.find((m) => m.orgId === currentOrgId);

  /* Three different facts, three different sentences. Never one blank. */
  const label =
    current?.orgName ??
    (currentOrgId ? 'Organization name unavailable' : 'No active organization');
  const named = Boolean(current?.orgName);
  const canSwitch = memberships.length > 1;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (orgId: string) => {
    setOpen(false);
    if (orgId === currentOrgId) return;
    setActiveOrgId(orgId);

    /*
     * RESET — kept after Task 12, for a DIFFERENT reason than it was chosen for.
     *
     * Task 10 measured three primitives against a data query whose key omitted
     * the org, which was every data query in this console at the time:
     *
     *   removeQueries()     no refetch at all. A mounted observer keeps its
     *                       last result and never asks again, so the previous
     *                       tenant's rows stay on screen indefinitely.
     *   invalidateQueries() refetches, correctly, under the new org header —
     *                       but keeps the old `data` visible for the whole
     *                       flight. That is another org's farmers, on screen,
     *                       under this org's name.
     *   resetQueries()      refetches under the new org header AND clears the
     *                       data first, so the screen shows a loading state.
     *
     * Task 12 then put the org into all twelve data keys, which raised the
     * obvious question: is this line now redundant? MEASURED, and no — it
     * changed job:
     *
     *   the key       stops the previous org's rows being SHOWN. A switch
     *                 changes every key, so nothing on screen can be answered
     *                 from the previous organisation's cache entry.
     *   resetQueries  stops them being HELD. The previous org's entries stay
     *                 in this tab's memory for gcTime after the switch —
     *                 unreachable, and still there. This empties them.
     *
     * That is the same property, and the same reason, as `qc.clear()` on sign
     * out below. `tenancy.contract.test.tsx` pins BOTH halves separately, so
     * neither can be deleted as "already covered by the other".
     */
    qc.resetQueries();
  };

  /* `border-control-edge`, not `border-line`: this is a control, and WCAG
     1.4.11 asks 3:1 of a control's boundary. The hairline that draws a table
     rule measures 1.25:1 on glass. globals.css §A.3 carries both numbers. */
  const chipClass =
    'inline-flex h-10 max-w-[16rem] items-center gap-2 rounded-chip border border-control-edge px-3.5 text-caption font-medium';

  return (
    <div ref={box} className="relative">
      {canSwitch ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(chipClass, 'glass-quiet text-text-1 hover:bg-wash')}
        >
          <Building2 size={14} className="flex-none text-text-2" aria-hidden="true" />
          <span className="sr-only">Active organization: </span>
          <span className={cn('truncate', !named && 'text-text-3')}>{label}</span>
          <ChevronDown size={14} className="flex-none text-text-2" aria-hidden="true" />
        </button>
      ) : (
        <span className={cn(chipClass, 'glass-quiet text-text-1')}>
          <Building2 size={14} className="flex-none text-text-2" aria-hidden="true" />
          <span className="sr-only">Active organization: </span>
          <span className={cn('truncate', !named && 'text-text-3')}>{label}</span>
        </span>
      )}

      {open && (
        <div
          role="menu"
          aria-label="Switch organization"
          className="glass-float absolute top-full left-0 z-30 mt-2 w-80 rounded-panel p-1.5"
        >
          {memberships.map((m) => (
            <button
              key={m.orgId}
              type="button"
              role="menuitem"
              onClick={() => choose(m.orgId)}
              className="flex w-full items-center gap-2 rounded-chip px-3 py-2 text-left hover:bg-wash"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-text-1">
                  {m.orgName}
                </span>
                <span className="block truncate text-caption text-text-3">
                  {m.orgType} · {m.orgRole}
                </span>
              </span>
              {m.orgId === currentOrgId && (
                <Check size={16} className="flex-none text-blue" aria-label="Current" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A manual Refresh, and a freshness chip that is allowed to speak because it
 * has a real reading behind it (register B14).
 *
 * WHAT "REFRESH" REFRESHES. `type: 'active'` is every query the CURRENT screen
 * is subscribed to, and nothing else. That is the route's query keys without a
 * route-to-key map, which would rot the first time a screen adds a hook.
 * Queries the operator has navigated away from are left alone.
 *
 * WHAT THE CHIP CLAIMS. The OLDEST reading on the screen, not the newest. If
 * one panel arrived ten seconds ago and another five minutes ago, "10s ago" is
 * false for half of what the operator is reading, so the chip states the age
 * of the stalest thing in front of them. When nothing on screen has ever
 * loaded there is no age to state and the chip does not render — a
 * `dataUpdatedAt` of 0 means "never fetched", and printing it would resurrect
 * the fabricated-freshness defect (D5) inside the control built to prevent it.
 *
 * THE TICKER IS NOT DECORATION. `fmt.age` formats one instant. Without a
 * re-render the label freezes, and a chip reading "1m ago" for the next twenty
 * minutes is stating an age it does not have. The cache subscription covers
 * every fetch; the 30-second interval covers the silence between them.
 */
function ScreenRefresh() {
  const qc = useQueryClient();
  const [, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const unsubscribe = qc.getQueryCache().subscribe(bump);
    const timer = setInterval(bump, 30_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [qc]);

  const active = qc.getQueryCache().findAll({ type: 'active' });
  const fetching = active.some((q) => q.state.fetchStatus === 'fetching');
  const stamps = active.map((q) => q.state.dataUpdatedAt).filter((t) => t > 0);
  const oldest = stamps.length > 0 ? Math.min(...stamps) : null;

  return (
    <>
      {oldest !== null && (
        <span
          className="hidden sm:inline-flex"
          title="Age of the oldest data on this screen, measured from when this browser last received it."
        >
          <FreshnessChip source="live" lastRefreshed={new Date(oldest).toISOString()} />
        </span>
      )}
      <button
        type="button"
        onClick={() => qc.invalidateQueries({ type: 'active' })}
        disabled={fetching}
        aria-label={fetching ? 'Refreshing this screen' : 'Refresh this screen'}
        className="glass-quiet inline-flex h-10 items-center gap-2 rounded-chip border-control-edge px-3.5 text-caption font-medium text-text-1 hover:bg-wash disabled:pointer-events-none disabled:opacity-50"
      >
        <RefreshCw
          size={14}
          className={cn('flex-none', fetching && 'animate-spin')}
          aria-hidden="true"
        />
        <span className="hidden md:inline">{fetching ? 'Refreshing…' : 'Refresh'}</span>
      </button>
    </>
  );
}

/**
 * Who is signed in, and the way out (D12, register B3).
 *
 * THE NAME COMES FROM THE TOKEN, AND THAT IS NOT A REGRESSION. `decodeJwt` is
 * documented as "NOT used for authorization" (lib/auth.ts:10-13) and D15 keeps
 * it that way: nothing below decides what the admin may SEE. The server does
 * that, per request, through /admin/me/scope. This reads two display claims —
 * `display_name` and `phone`, both stamped by the login path this console uses
 * (JwtTokenIssuer.cs:26-36) — to answer "who am I signed in as", which no
 * endpoint the console calls will tell it.
 *
 * WHEN THERE IS NO NAME, THERE ARE NO INITIALS. The OTP path issues an
 * identity-only token carrying neither claim (JwtTokenIssuer.cs:74-80). The
 * old code answered that case with a hardcoded 'AK', so every admin in every
 * org saw one person's initials. The honest answer is a person glyph: we do
 * not know who this is, and the avatar says so rather than inventing two
 * letters.
 */
function SignedIn() {
  const { session, logout } = useAdminAuth();
  const qc = useQueryClient();

  const claims = useMemo(() => (session ? decodeJwt(session.accessToken) : {}), [session]);
  const displayName = typeof claims.display_name === 'string' ? claims.display_name.trim() : '';
  const phone = typeof claims.phone === 'string' ? claims.phone : '';
  const initials = initialsOf(displayName, phone);

  const signOut = () => {
    /*
     * `logout()` removes ONLY the scope query (AdminAuthProvider.tsx:50).
     * Every other admin query — farm lists, users, farmer names, phone
     * numbers — stays in this tab's cache, and the application staleTime is
     * 60s (App.tsx:35), so the next admin to sign in on the same machine
     * inside the minute renders the previous admin's rows before any refetch
     * lands. Purge first, while the token is still valid, so nothing
     * re-fetches against a cleared session on the way out.
     */
    qc.clear();
    logout();
  };

  return (
    <>
      <span
        className="grid size-8 flex-none place-items-center rounded-full bg-brand-wash text-caption font-bold text-brand"
        title={displayName || undefined}
      >
        <span className="sr-only">
          {displayName
            ? `Signed in as ${displayName}`
            : 'Signed in; this account has no name on its token'}
        </span>
        {initials ? (
          /* PersonName is THE renderer for a person's name (register A34):
             the initials of a Marathi name are Devanagari and must resolve to
             Noto Sans Devanagari, not to the Latin face. */
          <PersonName name={initials} />
        ) : (
          <UserIcon size={15} aria-hidden="true" />
        )}
      </span>
      <button
        type="button"
        onClick={signOut}
        aria-label="Sign out"
        className="glass-quiet inline-flex h-10 items-center gap-2 rounded-chip border-control-edge px-3.5 text-caption font-medium text-text-1 hover:bg-wash"
      >
        <LogOut size={14} className="flex-none" aria-hidden="true" />
        <span className="hidden lg:inline">Sign out</span>
      </button>
    </>
  );
}

/** A58 — the breadcrumb the top bar has always shown. */
function humanizePath(path: string): string {
  if (path === '/') return 'Home';
  return path
    .split('/')
    .filter(Boolean)
    .map((s) => s[0]?.toUpperCase() + s.slice(1))
    .join(' / ');
}

/**
 * Initials, or nothing. Never a constant.
 *
 * First word and LAST word, so "Purvesh Chandrashkehar Arve" reads PA rather
 * than PC. Iterated by code point rather than indexed by UTF-16 unit, so a
 * name outside the basic plane cannot be cut in half.
 */
function initialsOf(name: string, phone: string): string | null {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    const first = [...words[0]][0] ?? '';
    const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';
    return first + last || null;
  }
  /* No name on the token. The last two digits of the admin's OWN phone are
     the only other identifier the token carries, and they are enough to tell
     two signed-in accounts apart. */
  if (phone.length >= 2) return phone.slice(-2);
  return null;
}
