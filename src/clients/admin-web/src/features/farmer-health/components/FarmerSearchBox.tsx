import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search } from 'lucide-react';
import { useFarmerHealth } from '../hooks/useFarmerHealth';

/**
 * Farmer search box (DWC v2 §4.4 component #7).
 *
 * Debounced 300 ms input that probes `useFarmerHealth(typed)` once the
 * user submits. On a successful response we navigate to the drilldown.
 * Anything else surfaces an inline message — non-fatal, doesn't block
 * Mode B rendering.
 *
 * Accepts a farmId, userId, or phone — the backend resolves ambiguity
 * server-side; the client just hands over the typed string.
 */

export interface FarmerSearchBoxProps {
  /** Optional callback used by tests / future ops surfaces. */
  onResolved?: (farmId: string) => void;
}

export function FarmerSearchBox({ onResolved }: FarmerSearchBoxProps) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [debounced, setDebounced] = useState('');

  // Debounce the draft → debounced 300 ms (used to keep submit-button
  // visually responsive but doesn't actually drive the query — that
  // happens only on explicit submit per UI brief Band 1).
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(draft.trim()), 300);
    return () => window.clearTimeout(t);
  }, [draft]);

  const query = useFarmerHealth(submitted, { enabled: !!submitted });

  // On a successful resolve, navigate. Done in an effect so we don't
  // call the navigator during render.
  useEffect(() => {
    if (query.isSuccess && submitted) {
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
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="farmer-health-search">Search farmer</label>
        <div className="relative">
          <Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            id="farmer-health-search"
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="farm ID, user ID, or phone"
            autoComplete="off"
            className="h-9 w-72 rounded-md border-2 border-surface-border bg-surface-kpi pl-8 pr-3 font-mono text-[13px] text-text-primary outline-none focus:border-brand-teal"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!debounced || query.isFetching}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-black px-3 text-[12px] font-bold text-white transition-colors hover:bg-black/85 disabled:opacity-50 dark:bg-brand-green dark:text-[#0b1416]"
        >
          {query.isFetching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Search
        </button>
      </div>

      {showNotFound && (
        <div role="status" className="text-[11px] font-semibold text-danger">
          Couldn&apos;t find that farmer in your scope.
        </div>
      )}
    </div>
  );
}
