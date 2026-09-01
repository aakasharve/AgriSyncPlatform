import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search } from 'lucide-react';
import { useFarmerHealth } from '../hooks/useFarmerHealth';

/**
 * FARMER SEARCH — the only way into a single farmer's record, and v3 HAS NO
 * FARMER SEARCH AT ALL (Preservation Register A29, B7).
 *
 * That is why this file is ported line for line rather than redrawn. Every
 * behaviour below is invisible in a screenshot, and a rewrite from the v3
 * design would not know to put any of them back:
 *
 *  1. THE 300ms DEBOUNCE GATES ONLY THE BUTTON, NOT THE QUERY. `debounced` is
 *     used in exactly one place — the button's `disabled` — so the control
 *     stops flickering between enabled and disabled while somebody types. It
 *     does NOT drive the request. A "cleanup" that wired the debounce to the
 *     query would turn one deliberate lookup into one lookup per pause in
 *     typing, against an endpoint that reads four matviews.
 *
 *  2. THE QUERY FIRES ON EXPLICIT SUBMIT, VIA `enabled`. `submitted` is null
 *     until Enter or the button, and `useFarmerHealth(submitted, {enabled})`
 *     is the idle-but-mounted mode A28 registers. Typing costs nothing.
 *
 *  3. IT ACCEPTS A farmId OR A userId OR A PHONE. The client does not parse,
 *     classify or validate the string — it hands the typed value over and the
 *     server resolves it. Adding a client-side "that doesn't look like a
 *     guid" check would reject the two inputs an operator actually has.
 *
 *  4. PROBE FIRST, NAVIGATE SECOND. It fetches the drilldown payload and only
 *     then routes, so a bad id can never land the reader on a broken page
 *     with a spinner or a 404 shell. This is the reason the whole component
 *     is a query rather than a link.
 *
 *  5. IT NAVIGATES TO THE SERVER-RESOLVED farmId, NOT THE TYPED STRING.
 *     `query.data?.data?.farmId ?? submitted`. Type a phone number and you
 *     land on `/farmer-health/<the farm's id>`, so the url is shareable and
 *     the drilldown's own fetch hits the cache. Routing the typed string would
 *     produce a url that only works for whoever typed it.
 *
 *  6. `encodeURIComponent` ON THE PATH SEGMENT — here for the route, and again
 *     in `farmerHealthApi` for the request.
 *
 *  7. THE MISS IS INLINE AND NON-BLOCKING. A failed lookup is one line under
 *     the box; the cohort behind it keeps rendering. It never becomes a page
 *     state, a modal or a redirect. 🛑 THE APOSTROPHE IN THAT LINE IS THE REAL
 *     TYPOGRAPHIC ONE (`&apos;` → ’), carried from the source. Retyping it as
 *     ' changes the rendered character.
 *
 *  8. `onResolved` IS AN EXTENSION POINT and it is called BEFORE `navigate`,
 *     so a future ops surface can intercept a resolution without racing the
 *     router.
 *
 * ── The effect, and why it is not "cleaned up" (A56) ──────────────────────
 * Navigation happens inside an effect, not during render, because calling the
 * navigator while rendering is a React error. `main.tsx` runs `StrictMode`, so
 * in development this effect is double-invoked — and `setSubmitted(null)` is
 * what makes the second invocation a no-op instead of a second navigation.
 * That `setState` inside an effect is what lint reports here
 * (`react-hooks/set-state-in-effect`, one of the console's eight warnings).
 * It is DELIBERATE and it is left visible: suppressing it would hide the one
 * line that makes the double-invoke safe.
 */

export interface FarmerSearchBoxProps {
  /** Called with the SERVER-RESOLVED farm id, immediately before navigation.
   *  The extension point A29 registers — tests use it, and so would an ops
   *  surface that wanted to resolve without routing. */
  onResolved?: (farmId: string) => void;
}

export function FarmerSearchBox({ onResolved }: FarmerSearchBoxProps) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [debounced, setDebounced] = useState('');

  /* 300ms, and it reaches the BUTTON only. See note 1. */
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(draft.trim()), 300);
    return () => window.clearTimeout(t);
  }, [draft]);

  const query = useFarmerHealth(submitted, { enabled: !!submitted });

  useEffect(() => {
    if (query.isSuccess && submitted) {
      /* Note 5: the server's id, falling back to the typed string only when
         the payload carries none. */
      const farmId = query.data?.data?.farmId ?? submitted;
      onResolved?.(farmId);
      navigate(`/farmer-health/${encodeURIComponent(farmId)}`);
      setSubmitted(null);
    }
  }, [query.isSuccess, query.data, submitted, onResolved, navigate]);

  function submit() {
    const v = draft.trim();
    if (!v) return;
    setSubmitted(v);
  }

  const showNotFound = query.isError && submitted;

  return (
    <div data-farmer-search="" className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="farmer-health-search">
          Search farmer
        </label>
        <div className="relative">
          <Search
            size={14}
            aria-hidden="true"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3"
          />
          <input
            id="farmer-health-search"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            /* Note 3, said on screen: three kinds of input, one box. */
            placeholder="farm ID, user ID, or phone"
            autoComplete="off"
            className="h-9 w-72 rounded-chip border border-line bg-page pl-8 pr-3 font-mono text-[13px] text-text-1 focus:border-blue"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!debounced || query.isFetching}
          className="inline-flex h-9 items-center gap-1.5 rounded-chip border border-line bg-blue px-3 text-[13px] font-semibold text-white transition-colors hover:bg-blue-press disabled:opacity-50"
        >
          {query.isFetching ? (
            <Loader2 size={12} aria-hidden="true" className="animate-spin" />
          ) : (
            <Search size={12} aria-hidden="true" />
          )}
          Search
        </button>
      </div>

      {showNotFound && (
        /* Note 7. `role="status"` and not `alert`: it is information beside a
           control, not an interruption of the page behind it. */
        <div data-search-miss="" role="status" className="text-[13px] font-semibold text-red">
          Couldn&apos;t find that farmer in your scope.
        </div>
      )}
    </div>
  );
}
