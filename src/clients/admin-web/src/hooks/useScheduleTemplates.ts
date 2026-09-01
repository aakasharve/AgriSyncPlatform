import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useOrgKey } from '@/lib/orgQuery';

/**
 * SCHEDULE TEMPLATES — the hook the plan has been naming since Task 12, and
 * the first request on this screen that can reach a route the server publishes.
 *
 * ── 🔴 THE SCREEN HAS NEVER ONCE TALKED TO THE API ───────────────────────
 * The page asked for
 *
 *     /shramsafal/reference-data/crop-schedule-templates
 *
 * The backend publishes
 *
 *     /shramsafal/reference/schedule-templates
 *
 * BOTH HALVES DIFFER — the group is `/reference`, not `/reference-data`, and
 * the route is `/schedule-templates`, not `/crop-schedule-templates`. Verified
 * end to end rather than inferred: `ModuleEndpoints.cs:10` opens
 * `MapGroup("/shramsafal")`, `:52` calls `MapReferenceDataEndpoints()`, and
 * `ReferenceDataEndpoints.cs:14,16` is `MapGroup("/reference")` then
 * `MapGet("/schedule-templates")`. `crop-schedule-templates` appears in **no
 * C# file in the repository**.
 *
 * So every request this screen has ever made returned 404, and the page
 * rendered that as *"No schedule templates found. Create one via the farming
 * app."* — a statement about the template table, printed over a routing
 * mistake. Fixed here.
 *
 * ── THE ENDPOINT TAKES NO PARAMETERS ─────────────────────────────────────
 * `GetScheduleTemplatesHandler.HandleAsync(ct)` takes a cancellation token and
 * nothing else: no page, no search, no crop filter, and **no organisation**.
 * `X-Active-Org-Id` is still stamped by the axios interceptor and is still
 * ignored by this handler. That is the eighth endpoint this port has checked
 * that takes no organisation; the two farmer-health endpoints are the only ones
 * so far that do (Task 22). The org stays in the query KEY — that separates
 * one tenant's cache entry from another's, which is all a key can do — and the
 * screen says in words that the list is platform-wide.
 *
 * ── ⚠️ NO ENVELOPE. DO NOT "FIX" THIS. ──────────────────────────────────
 * `Results.Ok(result.Value)` returns the DTO list **raw**: a bare JSON array,
 * no `AdminResponse` wrapper, no `data`, no `meta`. That makes **four**, and
 * the count is worth stating because it has been wrong twice: A27 registered
 * `/ops/health` as *"the ONE endpoint returning no envelope"*; Task 22 found
 * both farmer-health endpoints and corrected it to three; and A26 had already
 * registered THIS one, which neither count included. A reader who "tidies" this into `AdminResponse<T>` gets
 * `undefined` from `data.data` and a screen that renders blank over a healthy
 * 200 — exactly the defect Task 22 found on the sibling screen.
 *
 * No envelope also means **no `meta.lastRefreshed` and no server clock**, so
 * this screen cannot carry a freshness chip and cannot write a "checked at"
 * into a measured-zero block. Both consequences are handled on the page, and
 * neither is worked around with `new Date()` (D5).
 *
 * ── AN EMPTY ARRAY IS NOT REACHABLE, WHICH IS ITSELF THE FINDING ─────────
 * `GetScheduleTemplatesHandler.cs:31-34`: when the database returns no rows the
 * handler answers with `ReferenceDataCatalog.ScheduleTemplates` — **four
 * templates hardcoded in C#** (Grapes, Pomegranate, Sugarcane, Onion). So this
 * feed cannot report an empty table, and a client that receives `[]` is looking
 * at something the endpoint is not supposed to be able to produce. That is why
 * the screen's empty branch uses `measuredZero.unproven` rather than claiming a
 * measured zero.
 *
 * The repository method itself has no `try`/`catch` (`ShramSafalRepository.cs:575`),
 * so a database failure DOES surface as an error here — unlike the twenty-nine
 * catalogued swallow sites. A broken request on this screen is visible as one.
 */

/** A stage band. The day range is SYNTHESISED — see `stages` below. */
export interface ScheduleTemplateStage {
  name: string;
  startDay: number;
  endDay: number;
}

/** One activity in the template's task list. */
export interface ScheduleTemplateActivity {
  name: string;
  category: string;
  stageName: string;
  startDay: number;
  endDay: number;
  frequencyMode: string;
  intervalDays: number | null;
}

/**
 * THE SHAPE THE SERVER ACTUALLY SENDS — `ScheduleTemplateDto`
 * (`ReferenceDataDtos.cs:17-24`), seven fields, camel-cased by the default
 * ASP.NET serialiser.
 *
 * 🛑 IT IS NOT THE SHAPE THE OLD PAGE DECLARED. That interface was
 * `templateId · name · cropType · version · isPublished · taskCount ·
 * estimatedDurationDays`, and **five of those seven fields do not exist on this
 * endpoint**. Correcting the URL without correcting the type would have swapped
 * a 404 for a card of `undefined`s — and, because `isPublished` would be
 * `undefined` on every row, a console stating that **not one template is
 * visible to farmers**.
 *
 * Those five field names are not imaginary. They describe a DIFFERENT entity in
 * a DIFFERENT table: `ShramSafal.Domain.Schedules.CropScheduleTemplate`
 * (`ssf.crop_schedule_templates`) carries `IsPublished`, `CropKey`, `VersionTag`
 * and a `Tasks` collection, and it is the one a farmer adopts
 * (`AdoptScheduleHandler.cs:70-79` reads it and refuses an unpublished one).
 * **No endpoint in this repository lists it.** `GetCropScheduleTemplatesForCropAsync`
 * exists on the repository port (`IShramSafalRepository.cs:270`) and has no
 * caller outside test doubles. Routing this screen there is a backend change and
 * belongs to another plan; the screen says so instead of implying it is already
 * looking at it.
 */
export interface ScheduleTemplate {
  /** `Guid`. The row key. */
  id: string;
  /** As authored, e.g. "Grapes - Standard Seasonal Template". */
  name: string;
  /**
   * DERIVED SERVER-SIDE FROM `name`, not stored: `DeriveCropType` splits on the
   * first hyphen and takes the left side (`GetScheduleTemplatesHandler.cs:171-175`).
   * A template whose name has no hyphen reports its whole name as the crop.
   */
  cropType: string;
  /**
   * A PROPERTY OF THE CROP, WITH A 60-DAY FLOOR — not this template's duration.
   * `BuildStageDefinitionsByCrop` computes `max(60, largest activity offset
   * across EVERY template of this crop + 30)` and the DTO reports the last
   * stage's end day plus one, which is that same figure
   * (`GetScheduleTemplatesHandler.cs:139-147`, `:73-76`). Two templates of one
   * crop therefore always report the same number, and a template with no
   * activity at all still reports 60.
   */
  totalDays: number;
  /**
   * ALSO PER-CROP, AND THE DAY RANGES ARE SYNTHESISED. The names are the
   * distinct `Stage` values of every template of this crop; the boundaries are
   * `totalDays` divided into equal bands (`:149-158`). Nobody authored them.
   */
  stages: ScheduleTemplateStage[];
  /**
   * The template's own task list, and the only per-template collection here.
   * An empty array is the unauthored draft the screen names — never "0 tasks".
   */
  activities: ScheduleTemplateActivity[];
  /**
   * ONE HASH FOR THE WHOLE RESPONSE, IDENTICAL ON EVERY ROW.
   * `ComputeDtoVersionHash` hashes the entire mapped list once and then stamps
   * every template with it (`:121-122`). It is a payload fingerprint, not a
   * template version — the entity's own integer `Version` and its
   * `PublishedAtUtc` (`ScheduleTemplate.cs:54,57`) are not projected into the
   * DTO at all. Rendering it per card would invent per-template versioning.
   */
  versionHash: string;
}

/** The path the server actually publishes. Exported so a test can name the
 *  404 this screen used to send, and fail if it ever comes back. */
export const SCHEDULE_TEMPLATES_PATH = '/shramsafal/reference/schedule-templates';

/** The path that 404'd for the whole life of the screen. Kept as a named
 *  constant for the regression test and referenced nowhere else. */
export const SCHEDULE_TEMPLATES_404_PATH =
  '/shramsafal/reference-data/crop-schedule-templates';

export function useScheduleTemplates() {
  const org = useOrgKey();
  return useQuery<ScheduleTemplate[]>({
    queryKey: ['schedules', 'templates', org],
    queryFn: async () => {
      /* RAW ARRAY. There is no `.data.data` here and there never was — see the
         file header before changing this line. */
      const { data } = await adminApi.get<ScheduleTemplate[]>(SCHEDULE_TEMPLATES_PATH);
      return data;
    },
    /* Reference data. Five minutes, and no `refetchInterval`: nothing about a
       template changes on a poll, and this console runs against a 2-vCPU box. */
    staleTime: 300_000,
  });
}
