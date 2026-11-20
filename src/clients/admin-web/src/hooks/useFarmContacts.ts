import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { adminApi } from '@/lib/api';
import { AdminModuleForbiddenError } from '@/lib/adminErrors';
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
export function useFarmContacts(ids: string[], options?: FarmContactsOptions): Map<string, FarmContact> {
  return useFarmContactsState(ids, options).contacts;
}

export interface FarmContactsOptions {
  /**
   * CR-3 (I-1): a page that shows farm NAMES only asks with `namesOnly=true`. The server then
   * answers every ownerPhone as "**redacted**" and records no phone look. A page that shows a
   * phone leaves this off. Part of the request identity: the ids already asked about are
   * tracked per hook instance, so the mode never changes within one instance.
   */
  namesOnly?: boolean;
}

export interface FarmContactsState {
  contacts: Map<string, FarmContact>;
  /** True when a request for these ids failed and has not since been answered. */
  failed: boolean;
  /**
   * CR-3 (K22): true when the server REFUSED the request (403): the person does not hold the All
   * farms tick. Apart from `failed`: nothing broke, the names are simply not theirs to see, and a
   * page says so instead of silently keeping the short id.
   */
  refused: boolean;
}

/** A 403 as the console sees it: the module denial the interceptor raises, or a plain 403. */
function isRefusal(err: unknown): boolean {
  if (err instanceof AdminModuleForbiddenError) return true;
  return isAxiosError(err) && err.response?.status === 403;
}

/** Same as `useFarmContacts`, plus whether a request failed (so "not fetched" is honest). */
export function useFarmContactsState(ids: string[], options?: FarmContactsOptions): FarmContactsState {
  const namesOnly = options?.namesOnly === true;
  const org = useOrgKey();
  const [contacts, setContacts] = useState<Map<string, FarmContact>>(() => new Map());
  const [failed, setFailed] = useState(false);
  const [refused, setRefused] = useState(false);
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
      setFailed(false);
      setRefused(false);
    }
    if (!wantedKey) return;
    const fresh = wantedKey.split(',').filter((id) => !asked.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) asked.current.add(id);

    const sessionOrg = org;
    for (let i = 0; i < fresh.length; i += MAX_IDS_PER_CALL) {
      const batch = fresh.slice(i, i + MAX_IDS_PER_CALL);
      adminApi
        .get<FarmContactItem[]>('/shramsafal/admin/farms/contacts', { params: namesOnly ? { ids: batch.join(','), namesOnly: 'true' } : { ids: batch.join(',') } })
        .then(({ data }) => {
          if (!mounted.current || orgRef.current !== sessionOrg || !Array.isArray(data)) return;
          setFailed(false);
          setRefused(false);
          setContacts((prev) => {
            const next = new Map(prev);
            for (const c of data) {
              next.set(c.farmId.toLowerCase(), { name: c.name, ownerPhone: c.ownerPhone ?? null });
            }
            return next;
          });
        })
        .catch((err: unknown) => {
          if (isRefusal(err)) {
            /* Refused, not broken (K22): the ids stay marked as asked, so the same refusal is not
               asked for again on every poll; the page says the names need the All farms tick. */
            if (mounted.current && orgRef.current === sessionOrg) setRefused(true);
            return;
          }
          /* Not an empty answer: these ids stay unnamed and are asked about again
             if the id list changes. The page keeps showing the short id. */
          for (const id of batch) asked.current.delete(id);
          if (mounted.current && orgRef.current === sessionOrg) setFailed(true);
        });
    }
  }, [wantedKey, org, namesOnly]);

  return { contacts, failed, refused };
}
