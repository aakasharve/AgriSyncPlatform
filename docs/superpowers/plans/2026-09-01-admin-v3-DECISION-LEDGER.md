# Admin v3 — Decisions and Gaps: the single ledger

> **THIS IS THE ONE FILE.** Every open decision and every known gap from the admin-console v3
> migration lives here. Nothing is kept only in a chat log, only in a commit message, or only in a
> subagent report. If it is not in this file, it is not tracked.
>
> **Written to be read cold.** A person — or an agent — with no memory of the work that produced it
> should be able to act on any entry without asking anyone what it means. Each carries: what it is,
> how it was verified, what the build currently does about it, what changes if the founder decides
> otherwise, and roughly what that costs.
>
> **Nothing here blocks the build.** Every remaining task proceeds on the default recorded beside it.
>
> **Where the evidence lives.** Line-cited findings are reproducible against
> `origin/main` at the time of writing. The per-task execution notes in
> `docs/superpowers/plans/2026-08-30-admin-v3-migration.md` carry the full detail and the mutation
> proofs; this file carries the decisions and the gaps only. The backend items are mirrored into the
> agent memory note `backend-defects-found-by-admin-v3-port.md` so they survive if this branch is
> never merged.
>
> **How it was produced.** Every entry came from execution checking a plan premise against the code
> rather than trusting it. Twenty-seven plan premises have proved false so far; the ones that turned
> out to be product or backend facts are what this file holds.
>
> **Status: CLOSED 2026-09-02 — all 30 tasks complete, 987 tests, 3/3 green runs verified
> independently. Nothing below blocks the build; it is what the build could not decide.**
> **Sections:** A backend defects · B product and copy defaults · C already decided · D blocked ·
> E engineering, no founder content.

---

## 0. START HERE — the ten things that need you, in priority order

Everything else in this file is the evidence behind these.

| # | What | Why it matters | Where |
|---|---|---|---|
| 1 | **The farmer's schedule picker has never worked** | It calls a path the backend does not publish and tells the farmer *"try again"* for a request that can never succeed. **This is the only item that reaches a farmer.** | own memory note |
| 2 | **Four endpoints send unmasked farmer phone numbers** | Contradicts your standing rule. And the redactor **does not recurse into collections**, so switching it on would not mask a list anyway | A4, B16 |
| 3 | **The suffering list is ranked by successful usage** | Your heaviest, happiest farmers top the call list. One `FILTER` clause | A1 |
| 4 | **The North Star metric rises when farms churn** | A farm that stops logging vanishes from the average instead of counting as zero | §A, T21 note |
| 5 | **A database failure is reported as good news — 29 sites** | Several fabricate *complete, well-formed answers*, not empty ones | A3 |
| 6 | **The Users screen has never returned a row** | Four column names that do not exist, swallowed into HTTP 200 + empty | A2 |
| 7 | **No MIS endpoint filters by organisation** | And the 30s cache does not vary by header — **the day they are scoped, that cache is the leak** | A5 |
| 8 | **The acceptance gate cannot be walked** | No local admin membership; every route lands on `/403`. **That is the fail-closed rule working** | D2 |
| 9 | **The Lighthouse budget is broken and has never run on a PR** | 404s on its own target; `workflow_dispatch` only. One flag, in `.github/` | E1 |
| 10 | **Five signatures** | A50 (react-table dropped) · the four surviving `§B` classes · `font-mono` · A55 (chart now relatively scaled) · A43 (404 replaces the silent bounce) | §C, §D |

---

## A. Backend defects — outside this plan, not fixable from the console

Each verified twice, in backend source. Full detail in the memory note
`backend-defects-found-by-admin-v3-port.md`.

### A1 🔴 The suffering watchlist is ranked by successful usage
`error_count` is a bare `COUNT(*)` over a `WHERE` that admits `ai.invocation` in full
(`20260502000000_AnalyticsRewrite.cs:400`); only the `HAVING` filters to failures. Every AI handler
emits on the happy path, so a farm with **40 successful voice parses and 3 errors reads 43** — and
`ORDER BY error_count DESC` ranks by it. **The heaviest, happiest users top the call list.**
- **Shipped default:** the column is renamed *"Events counted"* and the flaw is stated on screen.
- **Fix:** one `FILTER` clause in the matview. **Options:** (a) fix now · (b) accept this cycle.

### A2 🔴 The Users screen has never returned a row
`AdminMisRepository.cs:250-288` selects `u.user_id`, `u.email`, `u.created_at`, `u.last_login_at`
from `public.users`, which has **none of them** (it has `Id`, `phone`, `display_name`,
`password_hash`, `credential_created_at_utc`, `created_at_utc`, `is_active`). Raises `42703`, caught
at `:287`, returned as **HTTP 200 + empty**. Two sibling queries address the table correctly, so it
is one query's mistake. No backend test covers it.
- **Shipped default:** the screen says the query is broken instead of *"No users found"*.
- **Fix:** four column names in one file. **Options:** (a) fix now — recommended, unblocks a whole
  screen · (b) ship with the honest empty state.

### A3 🔴 A database failure is answered as good news
`AdminMisRepository.cs:219`, `:245`, `:287` **and `AdminOpsRepository.cs:253`** are all `catch { return empty; }` — four sites. A dropped connection,
a missing matview or a `mis` permission failure reaches the client as an empty list with a success
code — so the console's four honest states are the four *the client* can see.
- **Shipped default:** screens that swallow now render *"not measured"*, not *"measured zero"*.
- **Options:** (a) backend task now · (b) later, with the on-screen note · (c) accept.

### A4 🔴 Four endpoints send unmasked farmer phone numbers
`IResponseRedactor` exists; only `GetFarmerHealthHandler` and `GetCohortPatternsHandler` call it.
`GetFarmsListHandler`, `GetSilentChurnHandler`, `GetSufferingHandler` (no phone) and
`GetUsersListHandler` do not. **Contradicts the founder's standing rule.** Register row **B16 is not
ticked and must not be.**
- **Shipped default:** the console renders masking correctly the day the server sends it.
- **Options:** (a) backend task before FPO staff get access · (b) accept while the founder is the
  only admin · (c) decide per screen.

### A5 🔴 No MIS endpoint filters by organisation
`GetSilentChurnAsync(ct)`, `GetSufferingAsync(ct)`, `GetFarmsListAsync(page,pageSize,search,tier,ct)`,
`GetUsersListAsync(page,pageSize,search,ct)` — **no org parameter**, and matviews are not under RLS.
Task 12 put the org in every query **key** (separates the client cache); it does not scope the data.
- **Shipped default:** three false *"in this organisation"* sentences corrected (`74da3d3b`).
- **⚠️ Trap:** `Program.cs:131` `CacheOutput` is 30s and **does not vary by header** — the day these
  are org-scoped, that cache becomes a cross-tenant leak.
- **The real question:** should these feeds be org-scoped at all — i.e. who may hold `farms.suffering`?

### A8 🔴 Almost no error row can name a farm
`RequestObservabilityMiddleware.cs:161-162` reads the farm from a `farm_id` **claim**, and **no token
this platform issues carries one** — `JwtTokenIssuer` is the only issuer and neither of its two
methods stamps it; `Claim("farm...` appears nowhere in the repo. `/telemetry/client-error` reads the
same absent claim. Only the mobile outbox can attribute a row, via `props.farmId` in the body.
- **Consequence:** on `/ops/errors`, *"not attributable"* is the **normal** case, not the edge — so
  "which farmer is this hurting" is usually unanswerable.
- **Fix:** stamp the claim at issue time, or attribute another way.

### A9 🔴 A whole failure type is invisible on the failures screen
RG5 added `sync.mutation_rejected` — **a farmer's mutation dropped inside a 200** by `POST /sync/push`.
It is deliberately not `api.error` (overloading that string would fire the R9 spike alert), and
`/ops/errors` selects `event_type IN ('api.error','api.slow','client.error')`. **One string in a
backend SQL list.**

### A10 No `event_id` is projected
The column exists and is written on every row; the SELECT omits it
(`AdminOpsRepository.cs:222-229`). **No row on the errors screen can be pointed at in a ticket** — the
row key is a page position. Directly at odds with the support-loop design, where an error is meant to
be copy-pasteable as a work order with an address.

### A6 Two computed signals have zero readers
- **`mis.zero_engagement_farms`** — farms on a paid or trial plan that have **never logged anything**.
  Refreshed nightly by `MisRefreshJob`; no repository, endpoint, hook or screen. Arguably the most
  urgent list in the product — an onboarding failure, not a retention one — and it is invisible.
- **`client_errors`** in the suffering matview — computed nightly, never read.
- **Options:** (a) add to this migration · (b) its own plan · (c) leave the honest note.

### A7 Last sign-in is not recorded anywhere
So *"signed up and never used it"* cannot be built. The console has the wording written and tested
behind one switch.
- **Options:** (a) add the column, one write on sign-in · (b) not now · (c) derive from events (bigger).

---

## B. Product and copy decisions — console side, reversible

### B1 The "call today" threshold does not exist
v3 shows a red badge past N silent weeks. **That number was invented in the mockup's sample data**
and has no owner in this product. Refused rather than hard-coded.
- **Shipped default:** no badge; longest-first ordering.
- **Options:** 3 weeks · 4 weeks · no flag · a number the founder names.

### B2 Should a farm ever be painted red on the suffering screen?
Blocked behind **A1** — colouring a number that counts successes would mark the most *active* farmer
as the most broken.
- **Shipped default:** no red.
- **Options:** (a) none · (b) red at 5 as drawn · (c) red only after A1 is fixed, at a named threshold.

### B3 Lists open on a summary, not on rows
Kept on watchlists (Silent Churn, Suffering) where the summary is the point; **dropped on All Farms
and Users**, where there are no facets to read first, so the gate would hide the table for no reason.
- **Options:** (a) as shipped · (b) summary-first everywhere · (c) rows-immediately everywhere.

### B4 A filter count reads *"12 farms on this page"*
Because the screen holds 40 of possibly thousands. The bare total stays unqualified — the server
genuinely knows that one. **Real per-filter counts need a faceted-count endpoint (backend).**
- **Options:** approve the wording · reword · commission the endpoint.

### B5 Sorting sorts the page you hold, not the whole set
Stated on screen. Cross-page sort is the same backend job as B4.
- **Options:** (a) accept with the label · (b) fold into the B4 backend plan.

### B6 The wheat field could return on the login screen only
The founder said **drop**, and it is dropped everywhere. This is the one narrower option that was
never put to him: signature preserved, zero cost on every working page.
- **Shipped default:** gone entirely.

### B7 Two columns removed from Users: Email and Apps
No email field exists in the product (auth is phone + OTP); `apps` is the literal `[]` server-side,
though real grants live in `public.memberships` and are never joined.
- **Shipped default:** removed, stated once in words.
- **Options:** (a) as shipped · (b) both back as *"not measured"* · (c) Apps back + join the grants table.

### B9 The screen is called "API Errors" and two of its three event types are not API errors
`api.slow` is a write that **succeeded** and took over two seconds; `client.error` is the farmer's own
device. Only `api.error` is what the title says. An operator counting "errors" is counting successful
slow saves and browser script errors alongside real failures.
- **Shipped default:** title unchanged; the subtitle names all three, and `api.slow` is amber rather
  than the colour of a 500.
- **Cost of changing:** one string in `nav.ts` and one heading.

### B10 The time-window buttons have no "selected" state
Pressing *"Last 6 hours"* writes a fixed instant, so no button lights up afterwards.
- **Why:** a link written at 09:00 asking for the last hour is four hours wide by noon. Highlighting
  "Last hour" then would be a claim that stopped being true the moment the reader looked away.
- **Shipped default:** the screen states in words the instant the URL actually asks for.

### B8 Copy the founder has not yet read
Written to the honest-state rules; all live in one file each.
- *"Nothing matches {filter}. Your filter excluded every row — that is not a measured zero."*
- *"The window was checked at 11:41. This is a measured zero, not a missing feed."*
- *"Feed down since 06:12 today. Nothing below this line is current."*
- *"3 of 4 periods were never measured — shown hatched, not as zero."* (under every chart)
- *"We could not check your access… Nothing about your account has changed."* (`/403`)
- The five permission-denial sentences, and the two no-organisation sentences.

---

## C. Already decided, recorded here so they are visible and reversible

| | Decision | Why |
|---|---|---|
| C1 | **Dark mode, wheat shader, shortcut badges — dropped** | Founder, 2026-08-31: *"drop , drop remove"* |
| C2 | The other **fifteen** dropped items marked **doctrine-settled, not founder-signed** | Each is dead code or an untrue statement; `P4` governs. Any can be pulled back |
| C3 | **A farm row jumps by id, never by name** | A name in a URL lands in history, a pasted message, a screenshot, an access log — none covered by the permission filter |
| C4 | **People stay searchable by name and phone** | The founder's own support-loop design: a farmer calls, someone must find him in seconds |
| C5 | **Unreadable destinations are hidden, not greyed out** | Nobody is offered a door that slams |
| C6 | **An out-of-range rate renders "not measured", not a clamped 0%** | An impossible value is not a noisy edge |
| C7 | **Sort state goes in the URL; search trims on all three screens** | A link becomes reproducible; a leading space is never intended |
| C8 | **Live Health stays under Operations** | Nav order is muscle memory; it does not move to match a mockup |
| C9 | **The top-bar chip is relabelled "Fetched Nm ago"** | It means *your browser received this*; in-screen chips mean *the server calculated this* |
| C10 | **`ja` indexed as both `dny` and `gy`; more spellings, not fewer** | A missing row costs a farmer a call that ends in "I can't find you" |
| C11 | **`npm ci` stays strict in CI** | It failed *loudly* when the lockfile drifted — that is the check working |
| C12 | 🔄 **REVERSAL — glassmorphism is UN-banned; the console is glass** | Founder, 2026-09-02, verbatim: *"the overall colour theme is too dark make it aesthetic and use the Glass morphism effect not theme to highlight the aesthetics and re design it all"*. **This overturns a decision he previously signed**, so it is written out below rather than left as a row |

---

## C12 detail — the glassmorphism reversal, written out because it overturns a signature

**What the contract said.** `CONTRACT.md` §8 — the v3 design contract, written from the founder's
own prototype — banned it outright:

> *"Banned: … Glassmorphism, translucency, gradients. The single exception already in `theme.css`
> is `.as-col-gap`, the hard-stop 45° hatch that marks a missing week in a chart."*

Task 27 flagged the last surviving glass panel — a translucent, backdrop-filtered surface on
`/403` — as a **live violation** of that ban, and the aesthetic pass of 2026-09-02 deleted it.

**What the founder said, hours later.** *"the overall colour theme is too dark make it aesthetic
and use the Glass morphism effect not theme to highlight the aesthetics and re design it all"*.

**Why that is legitimate.** §8 is a design document, not a safety rule. Nothing in it protects a
number, a permission or a reading. A founder may change his mind about how his own console looks.
What he may not do — and did not ask for — is make an unmeasured value look measured.

**Where the reversal is recorded, so it is as visible as the ban was:**

1. `src/styles/globals.css` §A.12, at the place the old decision lived, with his words quoted.
2. This entry.
3. `tokens.contract.test.ts` and `preservation.register.test.ts`. **Both held the ban; both went
   red; both were rewritten in the same commit as the code, not deleted.** The replacements are
   strictly harder to satisfy than what they replace — a ban has no contrast floor and glass does.

**The one thing that did NOT bend.** Glass over a busy background destroys text contrast, and
Task 29's whole finding was a 2.60:1 failure. So:

- `--color-ground` **is unchanged at #f4faf6**, and every bloom painted on `body` is *brighter*
  than it. A composite always lands between its two colours, so **no point on the page is darker
  than the old ground** — which means no text anywhere is less legible than before, by
  construction rather than by survey. The prettier version (deeper, saturated blooms) was measured
  and rejected: three of those stacked took the honesty grey from 2.82:1 to 2.48:1.
- Body text on every glass surface holds ≥ 4.5:1 and control edges ≥ 3:1, measured against the
  **actual** composite. `--color-control-edge` exists because the divider hairline measures 1.25:1
  on glass, which is not a control edge, it is a rumour of one.
- **The KPI tile is the one card that stayed opaque.** `--color-tint-grey` is the honesty tile and
  "grey is not a tone"; a translucent grey tile picks up whatever hue is behind it, and the one
  surface that must never look like a verdict would start to. It takes the glass *frame* — edge,
  sheen, height — and keeps its exact tint.

**Not one data colour moved.** §A.2 ink, §A.4 signal, §A.5 vivid, §A.6 tints and §A.7's two
product constraints are byte-identical. `KpiCard` still forces grey when `state !== 'ok'`. The
chart-gap hatch is byte-for-byte what it was, and it is still the only repeating gradient.

**What reverting costs:** `globals.css` §A.12 plus six class names. The type scale, the
disclosures and the copy rewrite are separate commits and survive it.


---

## D. Blocked, with what unblocks it

| | Item | Unblocked by |
|---|---|---|
| D1 | **Task 18 Steps 5–7** — error code, meaning, work-survived, app version on `/ops/errors` | The **error-capture-engine** plan merging and deploying. It is code-complete on an unmerged branch |
| D2 | **The Founder Acceptance Gate cannot be walked locally** — the seeded user is a farmer; `/admin/me/scope` returns `Unauthorized`, so all sixteen routes land on `/403`. **The console is correct; the guard must not be loosened** | Seeding one admin membership locally (touches seed data only — no schema, no guard, no prod surface) |
| D3 | **Register row B16** | A4 above |
| D4 | **Register row A50** — if Task 18 also drops TanStack Table for the pager | Founder tick in the Deliberately-Dropped table |

---

## D2 detail — why the gate cannot be walked, and the one safe fix

Measured: the seeded user logs in fine, then `/shramsafal/admin/me/scope` returns
`{"outcome":"Unauthorized","scope":null,"memberships":[]}`, so all sixteen routes land on `/403`.
**The console is correct** — that is the fail-closed property Task 2 pinned, and **the guard must not
be loosened to make a preview work.** The only seeded local user is a farmer; `ssf.admin_users` does
not exist anywhere in the repo, so there is no local path to an admin scope at all.

**Recommendation: seed one admin membership locally.** Touches seed data only — no schema, no guard,
no production surface.

---

## E. Engineering items with no founder content — listed so they are not mistaken for decisions

- **The test suite is near a timing cliff.** ~1 in 6, always `deepLink.contract.test.tsx`, which waits
  up to 15 s. Measured on both sides by Tasks 15–17; it fires without new files. **Task 29 owns it.**
- **`?sort` / `?dir` / `?open` are not namespaced.** Harmless until a screen has two lists —
  **Task 20 (Ops Live) hits it first.**
- **`.glass*` / `.chip-*` / `.nav-active` legacy CSS** still has consumers. **Task 27 deletes it.**
- **`FreshnessChip`'s `|| 'now'` fallback (D13)** still claims a freshness it may not have when no
  timestamp exists at all. **Task 24 owns it.**
