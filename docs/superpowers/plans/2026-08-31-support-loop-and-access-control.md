# Support Loop and Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop between a farmer having a problem and someone fixing it — he reports it in his own voice, the console shows his words beside the technical truth, a support person can act on what is actionable, and nobody but the founder can see a farmer's identity unless an open ticket justifies it and the look is recorded.

**Architecture:** Three new capabilities on existing foundations. A ticket is raised from a new Help section in the farmer's Setup Hub, voice-first, reusing `AudioRecorder`. It arrives already carrying the technical truth that the error-capture plan makes available. The console shows both stories side by side with a match verdict. Farmer identity is masked by default and revealed only through an open ticket for that farmer, with every reveal written to the existing append-only `AuditEvent`. Permissions move from hardcoded to founder-assignable through a new access screen over the existing 36-key `ModuleKey` vocabulary.

**Tech Stack:** .NET 10 (ShramSafal + User contexts), PostgreSQL 16, React 19 (mobile-web farmer app, admin-web console), existing `AudioRecorder`, `AuditEvent`, `ModuleKey`, `AdminScopeHelper`.

**Spec:** `_COFOUNDER/specs/_active/2026-08-31-support-loop/spec.md` — **must be authored before Task 1** (no spec, no PR).

---

## ⛔ Sequenced AFTER two other plans, and after they are proven in production

| Depends on | Why |
|---|---|
| `2026-08-30-error-capture-engine.md` | **Hard.** "His words next to the technical truth" needs a technical truth. Until that ships, the truth is `500` and a timestamp, and the match verdict cannot be computed. |
| `2026-08-30-admin-v3-migration.md` | **Hard.** The ticket list, the reveal control and the access screen are console screens. They must be built on the migrated design system and the restored guards, not the old console. |

**Founder instruction, 2026-08-31:** this plan is written now so the design is captured while fresh, and executed only **after the first two are built and their reliability is tested.** Do not start Task 1 before both are live and proven.

---

## Global Constraints

- **Nobody but the founder ever sees farmer-sensitive information by default.** Founder decision, 2026-08-31, stated after he reconsidered a looser position. The reason is his: someone could sell it as insight to another company.
- **A reveal is gated by an open ticket for that farmer.** Not a free-text reason. A reason can be typed four hundred times; four hundred legitimate tickets cannot be manufactured. This is what makes the control resistant to harvesting rather than merely inconvenient.
- **Every reveal is an `AuditEvent`** — who looked, at whom, under which ticket, when, from what device. Append-only, and visible to the founder.
- **The founder assigns permissions from the console**, not from a config file or a database row someone edits by hand.
- **Support may act, never rewrite.** The four permitted actions re-run what the system already tried. Correcting a farmer's record is explicitly out of scope (founder: "B now, C later").
- **The farmer never types.** Voice first; the tap-list is the fallback when the app cannot understand him or he prefers not to speak.
- **The app must not guess.** If it cannot confidently match what he said, it says so and offers the list. A wrong problem shown back confidently is worse than admitting we did not catch it — he would confirm it out of politeness.
- **No time is promised to the farmer.** A clock exists for us only.
- Conventional Commits. No `--no-verify`. Architecture tests pass. Every DB change is a migration, applied on boot under the ALLOW gate.

---

## Change Surface

**DB** — Three new tables in `ssf`: `support_tickets`, `ticket_events` (append-only timeline), and `admin_module_grants` (which person holds which `ModuleKey`, at which level). Two new `ModuleKey` constants. No change to `analytics.events`, `audit_events` or any existing table. All additive; the previous binary runs unchanged against the new schema (doctrine `E8`).

**Backend** — New use cases in `ShramSafal.Application`: raise a ticket, list tickets, act on a ticket, reveal contact, grant/revoke a module. New endpoints under `/admin/tickets`, `/admin/access`, and one farmer-facing `/support/tickets`. Extends `AdminScopeHelper` gating. Writes `AuditEvent` on every reveal and every grant change. No AI prompt touched, so no prompt-registry bump and no golden-set delta.

**Frontend** — `mobile-web`: a new Help section under the Setup Hub reusing `AudioRecorder`. `admin-web`: a Tickets screen, a ticket panel on the farmer page, the masked-identity control, and an Access screen. Both built on the v3 design system delivered by the migration plan.

**Cross-cutting** — No new secrets. No new prod infra. New personal-data processing (a farmer's spoken complaint), so the consent notice and retention rule must be extended — see Task 2. No SharedKernel event.

---

## Tasks

### Task 0: Land the spec

- [ ] **Step 1:** Write `_COFOUNDER/specs/_active/2026-08-31-support-loop/spec.md` from this plan's Goal, Global Constraints and Change Surface. The `commit-msg` hook requires a `spec:` trailer for any `src/**` commit.
- [ ] **Step 2:** Commit it to the `_COFOUNDER` repo (its own git repo — never mixed with the parent).

---

### Task 1: Somewhere for a complaint to live

**Files:** new migration in `ShramSafal.Infrastructure/Persistence/Migrations/`; `ShramSafal.Domain/Support/SupportTicket.cs`; `TicketEvent.cs`

- [ ] **Step 1:** Write a failing test asserting a `SupportTicket` cannot be created without a farm, a category and a raised-at time, and that its status starts `Open`.
- [ ] **Step 2:** Run it, confirm it fails (type does not exist).
- [ ] **Step 3:** Create the aggregate. Fields: `Id`, `FarmId`, `RaisedByUserId`, `Category`, `SpokenTranscript` (nullable), `MatchedProblemCode` (nullable), `Status` (`Open` / `Acting` / `Resolved` / `Closed`), `RaisedAtUtc`, `FirstSeenAtUtc` (nullable), `ResolvedAtUtc` (nullable). Status transitions live in a small state machine, mirroring `VerificationStateMachine`'s shape.
- [ ] **Step 4:** Create `TicketEvent` — append-only, one row per thing that happened: raised, seen, action taken, contact revealed, note added, resolved. This is the ticket's own history and it is never mutated.
- [ ] **Step 5:** Write the migration. `ssf.support_tickets` and `ssf.ticket_events`, both with FORCE row-level security on `agrisync.farm_id`, matching the pattern in `AddFarmBoundariesRls`.
- [ ] **Step 6:** Write an RLS test proving one farm cannot read another's tickets, opening with `AssertAppRoleIsNotVacuousAsync()` per doctrine `E3` — a proof run as superuser proves nothing.
- [ ] **Step 7:** Run the tests. **Step 8:** Commit.

---

### Task 2: Say what we are collecting, before we collect it

A spoken complaint is new personal data. This task exists so the consent notice and the retention rule are extended **before** the first recording is stored, not after.

- [ ] **Step 1:** Extend the DPDP consent notice to name the new purpose in Marathi and English: we record what you tell us about a problem, so we can fix it.
- [ ] **Step 2:** Add the retention rule for `SpokenTranscript` and any stored audio, following the existing voice-clip retention sweep rather than inventing a second mechanism.
- [ ] **Step 3:** Confirm an erasure request reaches ticket data. Write the test.
- [ ] **Step 4:** Run and commit.

---

### Task 3: The farmer's Help section — voice first

**Files:** `mobile-web/src/features/support/` (new); reuses `features/voice/components/AudioRecorder.tsx`; entry added to `features/profile/components/SetupHubMenu.tsx`

- [ ] **Step 1:** Add **मदत** to the Setup Hub menu.
- [ ] **Step 2:** Build the Help screen. A large mic is the primary action. Beneath it, quietly: *"किंवा यादीतून निवडा"* — or choose from the list.
- [ ] **Step 3:** On recording, send the audio through the existing transcription path and match the transcript to a problem category.
- [ ] **Step 4:** **The confirmation screen.** Show his own words, then the problem we matched, then ask:

  > **तुम्ही म्हणालात** — *"<transcript>"*
  > **आम्हाला असं समजलं** — **<matched problem>**
  > **हीच अडचण आहे का?**  **[ होय, बरोबर ]  [ नाही, पुन्हा सांगतो ]**

- [ ] **Step 5:** **If confidence is low, do not show a match.** Say we did not catch it and show the tap-list. Write a test that a low-confidence transcript never renders a matched problem — this is the rule most likely to be quietly dropped, and a wrong problem confirmed out of politeness is worse than none.
- [ ] **Step 6:** On confirm, raise the ticket and show:

  > **तुमची समस्या आमच्या पर्यन्त पोहोचली आहे.**
  > आम्ही बघतोय — थोडा वेळ लागू शकतो.
  > **काळजी करू नका, आम्ही तुमच्यासोबत आहोत.**

  Founder's wording, verbatim. **No time is promised.** During the pilot only, show the support number beneath.
- [ ] **Step 7:** The tap-list fallback: six categories with pictures, Marathi labels, including **मला समजत नाही** — I don't understand.
- [ ] **Step 8:** Tests, then commit.

---

### Task 4: The ticket arrives carrying the technical truth

- [ ] **Step 1:** On raise, attach what the system already knows for that farm: app version, last successful sync, every `api.error` in the last 48 hours with its `errorCode` and explanation, and whether work was kept. All of it exists once the error-capture plan has shipped.
- [ ] **Step 2:** Compute the **match verdict** — `Match`, `Partly`, or `NoMatch` — by comparing his matched category against what the system recorded.
- [ ] **Step 3:** Write the tests, one per verdict. **`NoMatch` is the valuable one**: he says it is broken, the system saw nothing. Assert it is never silently downgraded to `Match`.
- [ ] **Step 4:** Run and commit.

---

### Task 5: Masked by default

- [ ] **Step 1:** Add `ModuleKey.SupportTickets` and `ModuleKey.FarmerContactReveal`.
- [ ] **Step 2:** Every ticket and farmer response returns a **stable pseudonym** — `Farm K-114` — and omits name, phone and anything financial unless the caller holds the reveal grant AND the gate in Task 6 passes.
- [ ] **Step 3:** Masking happens **server-side**. Write a test asserting the API response contains no phone number for a caller without the grant. Client-side hiding is not masking — the data would still be on the wire.
- [ ] **Step 4:** Run and commit.

---

### Task 6: Reveal — gated by an open ticket, and always recorded

**This is the control the founder specified. Build it exactly.**

- [ ] **Step 1:** Write the failing tests first, because they are the specification:
  - a reveal with **no open ticket** for that farmer is refused
  - a reveal against **another farmer's** ticket is refused
  - a reveal against a **resolved** ticket is refused
  - a successful reveal writes an `AuditEvent` with actor, role, farm, ticket id, and device
  - the caller **without** `FarmerContactReveal` is refused regardless of ticket
- [ ] **Step 2:** Run them, confirm they fail.
- [ ] **Step 3:** Implement. The endpoint takes a ticket id, not a farmer id — the ticket **is** the justification, and there is no path that reveals without one.
- [ ] **Step 4:** Write the `AuditEvent` via `AuditEventFactory` — never a direct constructor (spine doctrine).
- [ ] **Step 5:** A founder-only view listing every reveal: who looked, at whom, under which ticket, when. **This is the point of the whole control** — not to stop the action, but to make it impossible to do unseen.
- [ ] **Step 6:** Run and commit.

---

### Task 7: The four things support can do

Founder decision: all four, with strict boundaries. Each re-runs something the system already attempted. **None alters what the farmer recorded.**

- [ ] **Step 1:** `POST /admin/tickets/{id}/retry-sync` — re-queue the farmer's failed sync.
- [ ] **Step 2:** `POST /admin/tickets/{id}/reparse-voice` — run the stored recording through the AI again.
- [ ] **Step 3:** `POST /admin/tickets/{id}/resend-code` — resend the login code.
- [ ] **Step 4:** `POST /admin/tickets/{id}/note` — record what the farmer said on the phone.
- [ ] **Step 5:** Every one requires an open ticket, checks `ModuleKey.SupportTickets`, appends a `TicketEvent`, and writes an `AuditEvent`.
- [ ] **Step 6:** Write a test per action asserting that **no farmer-authored field changes** — the boundary between acting and rewriting, and the easiest one to erode later.
- [ ] **Step 7:** Run and commit.

---

### Task 8: The Tickets screen, and the ticket on the farmer page

Founder decision: **both** places.

- [ ] **Step 1:** `/support/tickets` — one shared list, anyone with the grant can open any ticket. No assignment; ownership comes later if the team grows.
- [ ] **Step 2:** Each row: pseudonym, category, his words, the match verdict, age. Ageing shown **amber after a day, red after two** — our clock, never shown to him.
- [ ] **Step 3:** The ticket panel: his words beside the technical truth, the verdict, the timeline, the four action buttons, and the reveal control.
- [ ] **Step 4:** The same panel embedded on the farmer's page.
- [ ] **Step 5:** Built on the migration plan's `DataList` — **do not hand-roll another table.**
- [ ] **Step 6:** Run and commit.

---

### Task 9: The Copy button

- [ ] **Step 1:** One button producing a complete work order: pseudonym (or the real name only if already revealed under this ticket), farm, app version, server build, what he said, what actually broke with its plain-language explanation, whether his work survived, and the match verdict.
- [ ] **Step 2:** Test that an **unrevealed** ticket copies the pseudonym and never the name or phone — otherwise the button is a hole straight through the masking.
- [ ] **Step 3:** Run and commit.

---

### Task 10: Knowing a ticket arrived

Founder decision: **both**.

- [ ] **Step 1:** A count on the sidebar Tickets item — the badge slot already exists in the shell and has never been populated.
- [ ] **Step 2:** A phone notification on a new ticket. **Note honestly:** the existing alert job only writes a log line saying it *would* email; a real delivery channel does not exist yet and must be wired here rather than assumed.
- [ ] **Step 3:** Run and commit.

---

### Task 11: The access screen — you decide who sees what

Founder: *"build the access UI on console too so that as a founder I can allow who is able to see what."*

- [ ] **Step 1:** `ssf.admin_module_grants` — person, module key, level (read / write / export), granted by, granted at. Append-only history; a revoke is a new row, never a delete.
- [ ] **Step 2:** `/settings/access` — one row per person, one column per capability, tick to grant. Founder-only: gated on `ModuleKey.AdminUsers` plus the platform-admin flag.
- [ ] **Step 3:** `FarmerContactReveal` is **off for everyone by default.** Granting it shows a plain warning naming what it exposes.
- [ ] **Step 4:** Every grant and revoke writes an `AuditEvent`.
- [ ] **Step 5:** Test that a non-founder cannot reach the screen or the endpoint, and that removing a grant takes effect on the next request rather than at next login.
- [ ] **Step 6:** Run and commit.

---

### Task 12: The reports section — deliberately empty

Founder: *"just make that section, I will have to focus deliberately on that part — not a task carried out by this."*

- [ ] **Step 1:** Add a Reports item to the sidebar and an empty screen stating plainly that reports are not built yet and what will live here.
- [ ] **Step 2:** **Build no report.** Designing one without knowing its reader produces a page nobody opens.
- [ ] **Step 3:** Commit.

---

### Task 13: What is deliberately NOT in this plan

- [ ] **Step 1:** Record in the spec, so none is mistaken for an oversight:
  - **AI chat in the console** — founder: later. The provider infrastructure exists; the decision does not.
  - **Correcting a farmer's record from the console** — founder: after we have seen what actually goes wrong.
  - **Ticket assignment and ownership** — one shared list until the team grows.
  - **Pattern analysis across tickets** — needs months of real tickets first.
  - **Reports themselves** — Task 12 builds the room, not the furniture.

---

## 🛑 Founder Acceptance Gate

- [ ] **Raise a ticket by voice** on a real phone. Confirm the app shows your words, shows the problem it matched, and asks before raising anything.
- [ ] **Say something deliberately unclear.** Confirm it does NOT show a matched problem, and offers the list instead.
- [ ] **Open that ticket in the console.** Confirm you see a pseudonym, not a name.
- [ ] **Press reveal without an open ticket** — confirm it is refused.
- [ ] **Press reveal with the open ticket** — confirm the name appears AND a row appears in the reveal log naming you, the farmer, the ticket and the time.
- [ ] **Run each of the four actions.** Confirm each is recorded and that nothing the farmer wrote has changed.
- [ ] **Press Copy on an unrevealed ticket.** Confirm the clipboard has no name and no phone number.
- [ ] **Open the access screen**, grant a capability to a second account, and confirm that account gains exactly that and nothing else.
- [ ] **Confirm the farmer is never shown a time promise.**

**Founder approved: [ ]**

---

## Deployment Plan

Three surfaces, in this order — **API first, then web, then APK.** An APK that raises tickets against an API that cannot receive them is a broken first impression on the one screen a farmer opens when something is already wrong.

- [ ] RG1–RG5 release gates at G1. `NOT_PROVEN` blocks exactly as `FAIL`.
- [ ] RDS snapshot floor before the migration.
- [ ] **RG1 matters more than usual here** — this plan adds two RLS-protected tables and a new masked read path. The skip-list audit is not optional.
- [ ] Rollback: binary swap back. New tables are additive and the previous binary ignores them.
- [ ] Prod proof: `/version` returns the new SHA; a ticket raised from a real device appears in the console; a reveal appears in the audit log.
- [ ] `DEPLOYMENT_TRACKER.md` row and a Release Record at ship time.

**Done means live on prod.** Code-complete ≠ approved; approved ≠ deployed; written ≠ live.
