import { adminApi, type AdminResponse } from '@/lib/api';
import type { CohortPatternsDto, FarmerHealthDto } from '../farmer-health.types';

/**
 * THE TWO ENDPOINTS THAT DO NOT LOOK LIKE THE OTHER ELEVEN, IN TWO SEPARATE
 * WAYS — and only one of the two is in the Preservation Register.
 *
 * ── 1. THE PREFIX IS DIFFERENT (A26) ─────────────────────────────────────
 * Every other admin call in this console goes to `/shramsafal/admin/…`.
 * These two go to `/admin/farmer-health/…`, mapped directly on the root
 * route builder rather than under the `/shramsafal` group
 * (`AdminFarmerHealthEndpoints.cs:47` — `app.MapGroup("/admin/farmer-health")`,
 * with its own comment saying the same).
 *
 * 🛑 DO NOT CENTRALISE THE ADMIN PREFIX AS A TIDY-UP. There is nothing on
 * either screen that hints at this, so a refactor that hoists
 * `'/shramsafal/admin'` into `lib/api.ts` and rewrites every call site looks
 * like an obvious consolidation and 404s BOTH farmer-health screens at once.
 * `hooks/__tests__/queryContracts.contract.test.tsx` fails the moment either
 * url gains the prefix; so does this screen's own test.
 *
 * ── 2. THERE IS NO ENVELOPE, AND THAT IS NOT IN THE REGISTER ─────────────
 * 🔴 FOUND 2026-09-01 BY READING THE HANDLERS, AND IT IS A LIVE SCREEN-BLANKING
 * BUG, NOT A STYLE POINT.
 *
 * A27 records `/shramsafal/admin/ops/health` as "the ONE endpoint returning no
 * AdminResponse envelope". It is not the one. It is the third:
 *
 *   GetCohortPatternsHandler.cs:34  `Task<Result<CohortPatternsDto>>`
 *   GetFarmerHealthHandler.cs:45    `Task<Result<FarmerHealthDto>>`
 *
 * Every other admin handler returns `Result<AdminResponseDto<T>>` and stamps
 * an `AdminMetaDto` beside it (`GetFarmsListHandler.cs:15`,
 * `GetWvfdHistoryHandler.cs:15`, and six more). These two return the DTO bare,
 * and the endpoint writes it straight out with `Results.Ok(result.Value)`
 * (`AdminFarmerHealthEndpoints.cs:91`).
 *
 * This module used to declare the return type as `AdminResponse<T>` anyway.
 * The consequence was not a type error — it was a blank screen: the page read
 * `data.data`, got `undefined`, and rendered an empty queue, an empty
 * watchlist and four "not enough data yet" charts over a perfectly healthy
 * 200. Nothing logged, nothing red, no error branch reached.
 *
 * `unwrapFarmerHealth` accepts EITHER shape and normalises to one. That is
 * deliberately tolerant in both directions:
 *   - today the server sends the bare DTO, and the screen works;
 *   - the day the backend adds the envelope every other endpoint has, the
 *     screen keeps working AND starts showing a freshness chip, without a
 *     second frontend change.
 *
 * ── 3. WHAT FOLLOWS FROM HAVING NO `meta` ────────────────────────────────
 * `meta` is `undefined` today, so `metaRefreshedAt(meta)` is `undefined`, so
 * THERE IS NO FRESHNESS CHIP ON THIS SCREEN and there cannot honestly be one:
 * a chip may only state an age it actually has (Global Constraints, "No
 * fabricated freshness"; D5). It also means this screen has no server clock
 * to put in a `MeasuredZero` — see `NO_SERVER_CLOCK` in `FarmerHealthPage`.
 */

/** The normalised shape. `meta` is optional because today it never arrives. */
export interface FarmerHealthEnvelope<T> {
  data: T;
  meta?: AdminResponse<T>['meta'];
}

/**
 * Wrapped or bare, one shape out.
 *
 * The discriminator is deliberately BOTH keys, not either: `CohortPatternsDto`
 * and `FarmerHealthDto` carry no property called `data` and none called `meta`
 * (verified against `CohortPatternsDto.cs` and `FarmerHealthDto.cs`), so a
 * body holding both is an envelope and a body holding neither is a payload.
 * Testing only for `data` would misread a future DTO that happened to grow a
 * field of that name, and silently hand the screen one of its own members.
 */
export function unwrapFarmerHealth<T>(body: unknown): FarmerHealthEnvelope<T> {
  if (body !== null && typeof body === 'object' && 'data' in body && 'meta' in body) {
    const wrapped = body as AdminResponse<T>;
    return { data: wrapped.data, meta: wrapped.meta };
  }
  return { data: body as T };
}

export const farmerHealthApi = {
  /** Mode A drilldown — single farm, current week + 14-day timeline. */
  async getFarmerHealth(
    farmId: string,
    signal?: AbortSignal,
  ): Promise<FarmerHealthEnvelope<FarmerHealthDto>> {
    /* `encodeURIComponent` on the path segment: a farm id arrives from a
       search box a human types into (A29), so a slash or a space in it must
       not become part of the route. */
    const { data } = await adminApi.get<unknown>(
      `/admin/farmer-health/${encodeURIComponent(farmId)}`,
      { signal },
    );
    return unwrapFarmerHealth<FarmerHealthDto>(data);
  },

  /** Mode B cohort — aggregated scoring + intervention/watchlist queues. */
  async getCohort(signal?: AbortSignal): Promise<FarmerHealthEnvelope<CohortPatternsDto>> {
    const { data } = await adminApi.get<unknown>('/admin/farmer-health/cohort', { signal });
    return unwrapFarmerHealth<CohortPatternsDto>(data);
  },
};

export type FarmerHealthApi = typeof farmerHealthApi;
