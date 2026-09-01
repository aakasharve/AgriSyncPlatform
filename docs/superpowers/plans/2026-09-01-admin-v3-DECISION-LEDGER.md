# Admin v3 — Founder Decision Ledger

> **Purpose.** Every decision surfaced during the admin-v3 migration, collected in one place so the
> founder answers once rather than thirteen times. **Nothing here blocks the build.** Every remaining
> task proceeds on the honest default recorded beside it; each entry names what changes if he decides
> otherwise, and roughly what that costs.
>
> **Standing rule applied throughout:** where doctrine already settles a question (`P4` no fabricated
> numbers, fail-closed permissions, no PII beyond need), it was decided and recorded — not asked.
> This ledger holds only what genuinely needs him.
>
> Opened 2026-09-01, after Task 17. Appended as later tasks surface items.

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
`AdminMisRepository.cs:219`, `:245`, `:287` are all `catch { return empty; }`. A dropped connection,
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

---

## D. Blocked, with what unblocks it

| | Item | Unblocked by |
|---|---|---|
| D1 | **Task 18 Steps 5–7** — error code, meaning, work-survived, app version on `/ops/errors` | The **error-capture-engine** plan merging and deploying. It is code-complete on an unmerged branch |
| D2 | **The Founder Acceptance Gate cannot be walked locally** — the seeded user is a farmer; `/admin/me/scope` returns `Unauthorized`, so all sixteen routes land on `/403`. **The console is correct; the guard must not be loosened** | Seeding one admin membership locally (touches seed data only — no schema, no guard, no prod surface) |
| D3 | **Register row B16** | A4 above |
| D4 | **Register row A50** — if Task 18 also drops TanStack Table for the pager | Founder tick in the Deliberately-Dropped table |

---

## E. Engineering items with no founder content — listed so they are not mistaken for decisions

- **The test suite is near a timing cliff.** ~1 in 6, always `deepLink.contract.test.tsx`, which waits
  up to 15 s. Measured on both sides by Tasks 15–17; it fires without new files. **Task 29 owns it.**
- **`?sort` / `?dir` / `?open` are not namespaced.** Harmless until a screen has two lists —
  **Task 20 (Ops Live) hits it first.**
- **`.glass*` / `.chip-*` / `.nav-active` legacy CSS** still has consumers. **Task 27 deletes it.**
- **`FreshnessChip`'s `|| 'now'` fallback (D13)** still claims a freshness it may not have when no
  timestamp exists at all. **Task 24 owns it.**
