import { useEffect, useRef, useState } from 'react';
import { adminApi } from '@/lib/api';
import { useOrgKey } from '@/lib/orgQuery';

export interface FarmContact {
  name: string;
  ownerPhone: string | null;
}

interface FarmContactItem {
  farmId: string;
  name: string;
  ownerPhone: string | null;
}

/** The route takes 1 to 200 ids per call. */
const MAX_IDS_PER_CALL = 200;

/**
 * NAMES FOR FARM IDS, ASKED FOR ONCE PER ID (CR-2e Task 1).
 *
 * `GET /shramsafal/admin/farms/contacts?ids=a,b` opens the audited cross-farm
 * factory and writes one audit row per call. So this hook:
 *
 *   - asks only for ids it has not already asked about in this page session
 *     (a poll that returns the same farm ids makes no request);
 *   - never polls and never refetches on its own (no interval; the answer is
 *     held in component state, not a query that can go stale and refetch);
 *   - sends 200 ids at most per request.
 *
 * An id the server leaves out of its answer is unknown: it is simply absent
 * from the returned Map, and the caller shows the short id. A failed request
 * also leaves its ids absent (the caller keeps showing the short id) and the
 * ids may be asked about again the next time the id list changes.
 *
 * The Map is keyed by the lower-case farm id.
 */
export function useFarmContacts(ids: string[]): Map<string, FarmContact> {
  const org = useOrgKey();
  const [contacts, setContacts] = useState<Map<string, FarmContact>>(() => new Map());
  const asked = useRef<Set<string>>(new Set());
  const orgRef = useRef(org);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const wanted = Array.from(
    new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0).map((id) => id.toLowerCase())),
  ).sort();
  const wantedKey = wanted.join(',');

  useEffect(() => {
    /* A different organisation is a different page session. */
    if (orgRef.current !== org) {
      orgRef.current = org;
      asked.current = new Set();
      setContacts(new Map());
    }
    if (!wantedKey) return;
    const fresh = wantedKey.split(',').filter((id) => !asked.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) asked.current.add(id);

    const sessionOrg = org;
    for (let i = 0; i < fresh.length; i += MAX_IDS_PER_CALL) {
      const batch = fresh.slice(i, i + MAX_IDS_PER_CALL);
      adminApi
        .get<FarmContactItem[]>('/shramsafal/admin/farms/contacts', { params: { ids: batch.join(',') } })
        .then(({ data }) => {
          if (!mounted.current || orgRef.current !== sessionOrg || !Array.isArray(data)) return;
          setContacts((prev) => {
            const next = new Map(prev);
            for (const c of data) {
              next.set(c.farmId.toLowerCase(), { name: c.name, ownerPhone: c.ownerPhone ?? null });
            }
            return next;
          });
        })
        .catch(() => {
          /* Not an empty answer: these ids stay unnamed and are asked about again
             if the id list changes. The page keeps showing the short id. */
          for (const id of batch) asked.current.delete(id);
        });
    }
  }, [wantedKey, org]);

  return contacts;
}
