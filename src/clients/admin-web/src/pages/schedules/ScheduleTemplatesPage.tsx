import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { DataList } from '@/components/data';
import type { DataListColumn, RenderedField } from '@/components/data';
import { NotMeasured, NotMeasuredPanel, StandingNote } from '@/components/state';
import { fmt } from '@/lib/format';
import { useScheduleTemplates } from '@/hooks/useScheduleTemplates';
import type { ScheduleTemplate } from '@/hooks/useScheduleTemplates';

/**
 * SCHEDULE TEMPLATES — the screen that has never reached its endpoint.
 *
 * ── 🔴 WHAT WAS ACTUALLY WRONG HERE (Task 12 found it; this task owns it) ─
 * The page requested `/shramsafal/reference-data/crop-schedule-templates`. The
 * server publishes `/shramsafal/reference/schedule-templates`. Both the group
 * and the route differ, so every request 404'd, and the page rendered that as
 *
 *     No schedule templates found. Create one via the farming app.
 *
 * — a claim about the template table, printed over a routing mistake. The path
 * is fixed in `useScheduleTemplates`, which carries the proof.
 *
 * ── 🛑 AND FIXING THE PATH IS NOT THE END OF IT ──────────────────────────
 * The old `ScheduleTemplate` interface declared seven fields and **five of them
 * do not exist on this endpoint**: `templateId`, `version`, `isPublished`,
 * `taskCount`, `estimatedDurationDays`. Correcting only the URL would have
 * turned a 404 into a page of `undefined`s — and, because `isPublished` would
 * have been undefined on every card, a console telling an operator that **not
 * one template is visible to farmers**. A wrong answer arriving with HTTP 200 is
 * worse than no answer arriving at all.
 *
 * Those names belong to a different table. See the standing note at the foot of
 * this screen, which says so to the operator rather than only to a reader of
 * this file.
 *
 * ── D13: THERE IS NO CHIP, BECAUSE THERE IS NO AGE ───────────────────────
 * The old header carried `<FreshnessChip source="materialized" />` with no
 * `lastRefreshed` at all, so it printed a permanent *"Nightly · recent"* over an
 * endpoint that returns a raw array with no `meta` and no timestamp of any kind.
 * CONTRACT.md §9.1: every number states its source AND its age. This one has a
 * source and has no age, so it says exactly that, in words, and there is no
 * chip. `FreshnessChip` itself was changed in the same commit so the omission
 * cannot recur silently: `lastRefreshed` is now a required prop and a missing
 * age renders as "age not reported" rather than "recent".
 *
 * ── A4: THE ROUTE STAYS UNGATED ──────────────────────────────────────────
 * `App.tsx:311-315`. There is no `ModuleKey` for schedules — `ModuleKey.cs` has
 * no schedule entry — so a guard here could only be given a key that does not
 * exist, and `EntitlementGuard` fails closed: it would lock every admin out of
 * a screen that shows no farmer data at all. Unchanged, deliberately, and the
 * comment above the route is the record of why.
 */

/* ═══════════════════════════════════════════════════════ the predicate ═══ */

/**
 * THE UNAUTHORED DRAFT (Step 5). A template with an empty `activities` array is
 * a NAME AND NOTHING ELSE — it is not a schedule that plans zero tasks.
 *
 * v3 states the rule as *"a template with no authored task list says so instead
 * of implying zero"*, and it is the same distinction the whole state vocabulary
 * turns on: a measured 0 and an absent measurement are different facts. Printing
 * "0 tasks" here would tell an operator that somebody authored a schedule and
 * decided it needed no work.
 *
 * ONE predicate, read by the card, by the field, and by the note at the foot, so
 * the three can never disagree about which templates it is talking about — the
 * disagreement v3's own builder had to fix twice.
 */
function isUnauthored(t: ScheduleTemplate): boolean {
  return (t.activities?.length ?? 0) === 0;
}

/** Why the count is absent, in one sentence, used everywhere it is absent. */
const UNAUTHORED_WHY =
  'This template has a name and no task list. Nobody has authored an activity for it, so there is no count to show — not a count of zero.';

/* ═══════════════════════════════════════════════════════════ columns ════ */

/**
 * The columns are the SORT CONTRACT and the card's cells at once — `DataList`
 * renders each one and hands the results to `renderCard`, so nothing here is
 * declared and then left unrendered (the inert-configuration trap Task 17
 * deleted rather than kept).
 *
 * Labels are plain strings because the card layout puts them in `<option>`
 * elements as well as on the card.
 */
const COLUMNS: DataListColumn<ScheduleTemplate>[] = [
  {
    key: 'name',
    label: 'Template',
    sortType: 'text',
    sortValue: (t) => t.name.trim(),
    render: (t) => <span className="text-body font-semibold text-text-1">{t.name}</span>,
  },
  {
    key: 'crop',
    label: 'Crop',
    sortType: 'text',
    sortValue: (t) => t.cropType.trim(),
    /* NOT A STORED FIELD. `DeriveCropType` splits the NAME on its first hyphen
       (`GetScheduleTemplatesHandler.cs:171-175`), so this is a reading of the
       template's title, not a classification anybody applied. A template named
       without a hyphen reports its whole name here. Stated in the note below
       rather than in a tooltip, because it changes how the value should be
       read. */
    render: (t) => <span className="text-body text-text-1">{t.cropType}</span>,
  },
  {
    key: 'activities',
    label: 'Task list',
    sortType: 'num',
    sortValue: (t) => (isUnauthored(t) ? null : t.activities.length),
    /* An unauthored draft sorts as MISSING even though `length` is a number —
       `DataList`'s rule, and the sort-order expression of the same distinction
       the cell makes. */
    state: (t) => (isUnauthored(t) ? 'unmeasured' : null),
    render: (t) =>
      isUnauthored(t) ? (
        <NotMeasured state="unmeasured" why={UNAUTHORED_WHY} />
      ) : (
        <span className="text-body tabular-nums text-text-1">
          {fmt.num(t.activities.length)} {t.activities.length === 1 ? 'activity' : 'activities'}
        </span>
      ),
  },
  {
    key: 'window',
    /* NOT "Duration", and the rename is the honest part.
       `totalDays` is `max(60, the largest activity offset across EVERY template
       of this crop + 30)` (`GetScheduleTemplatesHandler.cs:139-147`, `:73-76`).
       Two templates of one crop therefore always report the same figure, and a
       template with no activity at all still reports 60 — so calling it this
       template's duration would attribute a crop-wide floor to one schedule.
       Task 14 renamed "Owner" to "Owner phone" for the same reason: the cheapest
       honest fix to a true value under a false heading is the heading. */
    label: 'Crop planning window',
    sortType: 'num',
    sortValue: (t) => (isUnauthored(t) ? null : t.totalDays),
    state: (t) => (isUnauthored(t) ? 'unmeasured' : null),
    render: (t) =>
      isUnauthored(t) ? (
        <NotMeasured
          state="unmeasured"
          why="The window is computed from the activity offsets of this crop's templates. With no activity authored anywhere on this template, the figure the server sends is its 60-day floor rather than a measurement."
        />
      ) : (
        <span className="text-body tabular-nums text-text-1">
          {fmt.num(t.totalDays)} days
        </span>
      ),
  },
];

/** What the client-side search box looks over. Module scope — `DataList`
 *  memoises the index per row set and a new function every render defeats it. */
const SEARCH_KEYS = (t: ScheduleTemplate): string[] => [t.name, t.cropType, t.id];

/* ══════════════════════════════════════════════════════════ the card ════ */

function templateCard(t: ScheduleTemplate, fields: RenderedField[]) {
  const by = new Map(fields.map((f) => [f.key, f]));
  const unauthored = isUnauthored(t);

  return (
    <article
      /* The leading edge marks the rows that need a person, and it is GREY
         rather than amber: the cell beside it is a grey em dash, an honesty
         state outranks a warning tone (CONTRACT.md §9.4), and an edge that
         disagrees with the cells it runs beside is worse than no edge. Never on
         every card. */
      className={
        'glass-panel flex h-full flex-col gap-3 rounded-panel p-4' +
        (unauthored ? ' border-l-4 border-l-text-3' : '')
      }
      data-template={t.id}
      data-unauthored={unauthored ? 'true' : undefined}
    >
      <div className="min-w-0">{by.get('name')?.node}</div>

      <dl className="flex flex-col gap-2 text-caption">
        {['crop', 'activities', 'window'].map((key) => {
          const field = by.get(key);
          if (!field) return null;
          return (
            <div key={key} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-text-2">{field.label}</dt>
              <dd className="min-w-0 text-right">{field.node}</dd>
            </div>
          );
        })}
      </dl>

      {/* THE FIELD THIS CARD DELIBERATELY DOES NOT SHOW.
          The old card printed a green tick and "Published" or a grey cross and
          "Draft" from `isPublished` — a field this endpoint does not send, so
          every card read "Draft". Publication is real (`ScheduleTemplate.cs:57`
          stores `PublishedAtUtc`, and the templates a FARMER adopts are gated on
          their own `IsPublished`), it is simply not projected into this DTO. A
          screen that cannot see it must not guess, and must not let its silence
          read as "no". Said once per card rather than only in the note, because
          the card is where the reader looks for it. */}
      <p className="mt-auto text-caption text-text-3">
        Whether farmers can see this template is not carried by this feed.
      </p>
    </article>
  );
}

/* ═══════════════════════════════════════════════════════════ the page ═══ */

export default function ScheduleTemplatesPage() {
  const { data, isLoading, isFetching, isError, error, refetch } = useScheduleTemplates();

  /* RAW ARRAY — no `.data.data`. See the hook's header. */
  const templates = useMemo(() => data ?? [], [data]);

  const unauthored = useMemo(() => templates.filter(isUnauthored), [templates]);

  /**
   * ONE hash for the whole payload, not one per template
   * (`GetScheduleTemplatesHandler.cs:121-122`). Printing it on every card would
   * invent a per-template version the API does not have, so it is stated once,
   * for the set, where it is true. Every template in a response carries the same
   * value; if they ever differ, this shows the first, which is a visible
   * symptom rather than a silent average.
   */
  const setVersion = templates[0]?.versionHash;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
            <CalendarDays size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            Schedule Templates
          </h1>
          {/* v3's subtitle read "Only published templates are visible to
              farmers." That is true of the OTHER template table and cannot be
              said over this list — see the note at the foot. No
              "in this organisation" either: the handler takes no org parameter,
              so the org in the query key separates the cache and does not scope
              the data — the eighth endpoint checked that takes none. */}
          <p className="mt-1 text-body text-text-2">
            The crop schedules the activity planner derives its plan from, platform-wide. Every
            template the server holds is here &mdash; this feed has no pages and no filter.
          </p>
        </div>

        {/* D13 — WHERE THE FRESHNESS CHIP WAS.
            Not a chip, because a chip states an age and there is no age to
            state: this endpoint returns a raw array with no `meta` and no
            timestamp of any kind. The source is still named, because a reader
            is entitled to know where a figure came from even when nobody can
            tell them when. */}
        <p className="text-caption text-text-3">Reference data &mdash; no timestamp available</p>
      </div>

      <DataList<ScheduleTemplate>
        id="schedule-templates"
        label="Schedule templates"
        caption="Every crop schedule template this endpoint returns, with its crop, the size of its authored task list and the planning window computed for that crop."
        noun={{ one: 'template', many: 'templates' }}
        rows={templates}
        rowKey={(t) => t.id}
        columns={COLUMNS}
        /* CARDS, NOT A TABLE (v3 CONTRACT.md Appendix 12). Same component, same
           config, different body — see `DataList`'s header on why this did not
           become a second list. */
        renderCard={templateCard}
        /* The endpoint has no pages: `HandleAsync(ct)` takes no page argument. */
        pagination={{ mode: 'none' }}
        defaultSort={{ key: 'crop', dir: 'asc' }}
        search={{
          /* CLIENT-side, and it can be: the whole answer is in hand — there is
             no server-side search on this endpoint to defer to. */
          mode: 'client',
          commit: 'submit',
          paramKey: 'search',
          placeholder: 'Search by template name, crop or id…',
          label: 'Search schedule templates',
          keys: SEARCH_KEYS,
          searchesOver:
            'Template name, crop and template id. The crop itself is derived from the name, so searching a crop searches the same words.',
        }}
        states={{
          isLoading,
          isFetching,
          error: isError ? error : null,
          onRetry: () => void refetch(),
          measuredZero: {
            what: 'This endpoint returned no templates',
            /* THERE IS NO CLOCK. `checkedAt` is required precisely so a screen
               cannot render an empty result without saying when it looked — and
               this screen genuinely cannot, so it says that instead of
               computing `new Date()` (D5). The `unproven` block below is what
               actually renders, so this string is the belt to its braces. */
            checkedAt: 'a time this endpoint does not report',
            /* AN EMPTY ANSWER HERE IS NOT A MEASURED ZERO — it is a state the
               endpoint is not supposed to be able to produce. When the database
               holds no template rows the handler substitutes four templates
               hardcoded in C# (`GetScheduleTemplatesHandler.cs:31-34`), so an
               empty array means neither "the table is empty" nor "the query
               failed": both of those have other answers. */
            unproven: (
              <>
                <p>
                  <b>An empty list here is not a measured zero, and it is not an empty table
                  either.</b>{' '}
                  When the template table holds no rows this endpoint answers with four templates
                  built into the server &mdash; Grapes, Pomegranate, Sugarcane and Onion &mdash;
                  rather than with nothing. So a genuinely empty database does not look like this,
                  and what has been received is a shape the endpoint is not meant to produce.
                </p>
                <p className="mt-2">
                  There is also no timestamp on this feed, so nothing here can state when the
                  check was made.
                </p>
              </>
            ),
          },
        }}
        /* B12 — shaped like the real thing: a card with a title and three
           fields. */
        skeleton={{ rows: 6, cells: 4 }}
      />

      {/* ── THE UNAUTHORED DRAFTS, NAMED (Step 5) ────────────────────────
          Built from the data, and hidden entirely when there are none, so the
          page can never assert a shortfall the answer does not contain. This is
          v3's shell note, over the field this endpoint actually carries. */}
      {unauthored.length > 0 && (
        <NotMeasuredPanel
          title={
            unauthored.length === 1
              ? 'One template has no task list'
              : `${fmt.num(unauthored.length)} templates have no task list`
          }
          why={
            <>
              <p>
                A template with no authored activity is a name and nothing else. It is not a
                schedule that plans no work, so neither its task count nor its planning window is
                shown as a number:{' '}
                {unauthored.map((t) => t.name).join(', ')}.
              </p>
              <p className="mt-2">
                The activity planner derives a farmer&rsquo;s plan from these activities, so a
                template in this state cannot produce one.
              </p>
            </>
          }
        />
      )}

      {/* ── WHAT THIS LIST IS, AND IS NOT ────────────────────────────────
          Every claim below was read out of the backend on 2026-09-01. It is on
          the screen rather than only in this file because each one changes how
          a value above should be read, and an operator cannot open the C#. */}
      <StandingNote
        title="What this list does not carry"
        why={
          <>
            <p>
              <b>These are not the templates a farmer subscribes to.</b> This feed reads{' '}
              <code className="font-mono text-caption">ssf.schedule_templates</code>, the planning
              templates the activity planner works from. The ones a farmer adopts live in{' '}
              <code className="font-mono text-caption">ssf.crop_schedule_templates</code>, they carry
              their own published flag, and <b>no screen or endpoint in this product lists them</b>.
              Whether a farmer can see a schedule cannot be answered from here.
            </p>
            <p className="mt-2">
              <b>Publication state is not sent.</b> The row records when it was published; the API
              does not project it. The card above says so rather than showing every template as a
              draft, which is what this screen did before.
            </p>
            <p className="mt-2">
              <b>The crop is read off the name.</b> The server splits the template name at its first
              hyphen and calls the left-hand side the crop. Nobody classified these.
            </p>
            <p className="mt-2">
              <b>The planning window belongs to the crop, not the template</b>, and it never goes
              below 60 days. Two templates of one crop always report the same number.
            </p>
            {setVersion && (
              <p className="mt-2">
                <b>There is one version for the whole answer, not one per template.</b> The server
                hashes the payload it is about to send and stamps every row with it, so this is a
                fingerprint of this response:{' '}
                <code className="font-mono text-caption">{setVersion.slice(0, 12)}</code>. It is not a
                template version and it does not survive a change anywhere else in the list.
              </p>
            )}
            <p className="mt-2">
              <b>The list is platform-wide.</b> This endpoint takes no organisation, so switching
              organisation does not change what is on this screen.
            </p>
          </>
        }
      />
    </div>
  );
}
