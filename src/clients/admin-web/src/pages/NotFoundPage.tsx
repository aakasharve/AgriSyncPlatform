import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * 404 — THE PAGE THAT REPLACED A SILENT BOUNCE (Preservation Register A43,
 * decided in Task 27 Step 2).
 *
 * `App.tsx` used to end its route table with `<Route path="*" element={
 * <Navigate to="/" replace/>} />`. Every unknown path — a typo, a stale
 * bookmark, a link from a Slack message written before a route was renamed,
 * and a bug — arrived at Home, with the address bar rewritten and nothing
 * said. The three readings are indistinguishable, and that is not a
 * hypothetical: it is exactly how defect D11 survived. `FarmsListPage`
 * navigated every row click to `/farms/:farmId`, a route this console has
 * never registered, under a table styled `cursor-pointer` on every row. The
 * catch-all swallowed it. Nobody saw a broken link because there was never
 * a broken link to see — only a table where clicking a farm took you Home.
 *
 * A silent redirect is a swallowed failure with a friendly face. This page
 * is the landing place that redirect never had: it names the path that did
 * not match, so a wrong link is legible as a wrong link.
 *
 * ── TWO THINGS IT DELIBERATELY DOES NOT DO ──────────────────────────────
 *
 *  1. IT DOES NOT REDIRECT, and it does not `replace`. The bad URL stays in
 *     the address bar, because that URL is the evidence — it is what gets
 *     pasted into a bug report or read back over a phone call. Rewriting it
 *     destroys the only copy.
 *
 *  2. IT DOES NOT GUESS. There is no "did you mean /farms?" No route table
 *     is exported for it to search, and a wrong guess on an operations
 *     console sends someone confidently to the wrong organisation's data.
 *     The nav is already on screen — this page sits INSIDE the shell, below
 *     RequireAuth and RequireScope, for exactly that reason. A signed-out
 *     visitor still gets sent to /login, unchanged.
 */
export default function NotFoundPage() {
  const location = useLocation();

  return (
    <div className="grid min-h-[60vh] place-items-center px-6 py-16">
      <div className="max-w-lg text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-panel bg-wash text-text-2">
          <Compass size={26} strokeWidth={2} aria-hidden="true" />
        </div>

        <h1 className="mb-2 text-xl font-semibold tracking-tight text-text-1">
          404 · No page at this address
        </h1>

        <p className="mb-2 text-[15px] text-text-2">
          This console has no route matching the address below. Nothing is broken and nothing was
          denied — the path simply does not exist here.
        </p>

        {/*
          The path, verbatim, including the query string. `pathname + search`
          rather than `pathname` because this console keeps its whole state in
          the query string — a filter, a page, a window and the ACTIVE
          ORGANISATION — and truncating it would hide the half most likely to
          be the actual mistake.
        */}
        <p className="mb-6 text-[13px] break-all text-text-3">
          <span className="sr-only">Requested address: </span>
          {location.pathname}
          {location.search}
        </p>

        <div className="flex justify-center gap-2">
          <Link to="/">
            <Button variant="outline">Go to Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
