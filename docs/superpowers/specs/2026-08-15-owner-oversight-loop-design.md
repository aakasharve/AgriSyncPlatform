# Owner's Oversight Loop — locked design spec

**Date:** 2026-08-15 · **Branch:** `feat/owner-oversight-loop`
**Status:** FOUNDER-APPROVED as final design. Locked.
**Approved artefacts:** `G:\VALIDATION\canonical-header.html`,
`G:\VALIDATION\home-screen-revised.html`, `G:\VALIDATION\owner-oversight-options.html` (Option 2 drawer UI)

---

## 0. What this is

The loop being built: **authorised person records work → owner becomes aware → owner reviews →
owner approves, questions, or simply oversees.**

This is not a data-entry feature. It is the owner's farm-control layer, and it is the thing 50–100
validation farmers will judge the product by.

> **The one-line test.** If an owner cannot open the app and know, within seconds, what happened on
> his farm and what needs him — this is not done.

---

## 1. LOCKED PRINCIPLES

These outrank any implementation convenience. An implementer who believes one is wrong stops and
produces evidence.

### P-A · Two independent axes

```
Awareness:   Unseen ─────────► Seen
Decision:    Approval required ──► Approved / Verified / Disputed
```

A record sits at a point on **both**. `Seen + Approval required` is normal and common.

**Seeing must never change decision state.** This is structural, not conventional: awareness lives
on the **owner** (one checkpoint per owner per farm), decision lives on the **record**
(`verification.status`). They are in different places, so no code path can collapse them.

### P-B · Awareness is one checkpoint, not a flag per record

One value per `(owner, farm)`: the moment of his last deliberate acknowledgement. Everything whose
server timestamp is newer is unseen.

- **No per-record seen flags.** No read receipts. No delivery tracking. No notification history.
- **Never reuse `FarmMembership.LastSeenAtUtc`** (`FarmMembership.cs:59`). It means "last activity",
  it is dead (`RecordActivity` has zero callers), and repurposing a field to mean something new is
  the silent meaning-change P3 forbids. New field, honest name.

### P-C · The boundary is server-authoritative, not a click time

"Unseen" compares each record's **server** timestamp against the checkpoint. A log recorded offline
five days ago that only reaches the server today is **new to the owner** and must appear.

Consequence, and it must be visible in the UI: each row carries **its own work date**, so a late
arrival can never masquerade as fresh work, and fresh work is never hidden for being dated old.

### P-D · Acknowledgement never fakes success

No silent queue in V1. The tick confirms only after the write succeeds. On failure the activity
stays unseen and a small, clear retry state appears. No optimistic success.

### P-E · Build only control that is real

Ship **"can approve farm-work logs"** as a genuine separate grant.
**Do not build or display an expense-verification switch.** Expense verification is not a
server-governed action today — money events live in `FinanceLegacyStore` (browser storage),
`CorrectCostEntry` has no authorizer, and "approve" only flips local state. A switch for it would
look functional and control nothing.

Recorded as explicitly deferred until finance has a server-authoritative home and real enforcement.
**Do not add farmer-facing text explaining the gap** — that adds confusion without giving control.

### P-F · No fabricated numbers, ever

Every figure is **derived from the rows shown**, never typed in.

- The people tally counts **named people only**. Records whose creator was not captured are
  reported separately, because "records with no person" is not a person.
- `meta.createdByOperatorId` is optional. Where absent, the row reads **अज्ञात** — never guessed,
  never bucketed into "Other". The field's own comment is binding: *"absent means not recorded, and
  never licenses a guess."*

### P-G · Colour carries the two-axis rule

`bg-emerald-600` **already means Approve** in this app (`ReviewInbox.tsx:97`,
`AttentionCard.tsx:121`). Therefore:

- **The Seen control is never emerald.** White with a `2px` neutral (`stone-400`) border.
- Green = *where you are* (identity/context). Amber = *what needs you*.

A farmer reads colour before text. If Seen were green, colour would say "approved" whatever the
words said.

### P-H · Calm at scale

Fifty records from four people produce **one briefing**, not fifty rows. The screen gets **shorter**
as the farm gets busier, because it summarises by person.

### P-I · The recording path stays sacred (P9)

Nothing added here may put a required field, modal, warning or nag on the path to recording work.

---

## 2. THE CANONICAL STRIP

Lives in `AppHeader` — which already renders on every route — so it is canonical on
**Log · Reflect · Compare** and every other screen **by construction**, with no per-page work.

It **replaces** the current farm-name-plus-sync line.

```
┌──────────────┐  ┌────────────────────────────────────┐
│ 🌿 Arve Farm⌄│  │ ⚠  तुम्हांसाठी बाकी          ⑥   ⌄ │
│    ४ प्लॉट    │  │    WAITING FOR YOU                 │
└──────────────┘  └────────────────────────────────────┘
   135 × 52px              241 × 52px
   emerald · WHERE          amber · WHAT NEEDS YOU
```

**Locked measurements:** both 52px tall (above the 44px minimum). Waiting is ~1.8× the farm's width
because it is the only one carrying information. Strip total ~67px.

**Two separate buttons with a gap — not one split bar.** Two shapes read as two things faster than
one bar with a divider, which matters most for someone not reading the words.

### 2.1 Farm chip (left, emerald)

- Leaf mark on `emerald-600`, farm name `13px/800` in `emerald-800`, plot count beneath, chevron.
- Opens the **existing** `FarmSwitcherSheet` unchanged — `तुमच्या शेती`, sprout tiles, role badge,
  farm code, `शेती तयार करा` / `QR ने जोडा`. **Only the trigger's shell changes.**
- One tap to open, one tap to switch.

### 2.2 Waiting button (right, amber)

- Icon, label, count pill, chevron. **The label is required** — a bare count says something is wrong
  but not what kind of thing.
- **Rest state keeps its exact place and size**, turning white with a green tick. The layout never
  reshuffles, so the strip is a fixed landmark.

---

## 3. THE WAITING DRAWER

Opens on tap. Contents, in this order — **decisions above information**:

### Band 1 · Needs your decision

One amber row per item, never one card per record:

| Row | Source |
|---|---|
| `६ कामे तपासायचे आहे` | records with `verification.required` outstanding |
| `कालचा दिवस बंद झाला नाही` | `yesterdayDayState` not closed |
| `२ नोंदी पाठवता आल्या नाहीत` | the sync `NEEDS_FIX` set |

**Delegated case:** same row, same position, **no action affordance** — it names who holds the
authority instead. The owner keeps full visibility; only the buttons differ. Never infer the
owner's physical location from permissions.

### Band 2 · Since you last looked

The briefing card, exactly as approved in Option 2:

- Headline `पुन्हा स्वागत! शेतात काय चाललं?`
- Sub `तुमच्या शेतनोंदीत नवीन नोंदी आहेत. तपासा.` + "since you last looked — N days"
- **Tallies** — `N लोक · N कामे · N प्लॉट`, hairline dividers, the largest type in the drawer
- **One row per person** — coloured pin (from the app's existing `getUserColor`), name, `N · N प्लॉट`,
  and a one-line description of what they did
- The **अज्ञात** row, with a grey pin
- The **Seen control** at the bottom, after all content, so the thumb travels over the material

Tapping any row opens the existing filtered detail view. **Approving happens there. The drawer never
approves.**

---

## 4. WHAT IS REMOVED

### 4.1 The sync indicator — deleted from the header

Analysed against the code before removal. It has four states; `null` already renders nothing.

**Three of the four are worth nothing to a farmer** — "synced", "sending", "on phone" describe
plumbing. A farmer has no model of a server; he has a model of *"is my work safe and will the owner
see it?"*

**The one state carrying real value was never a status — it was a task:** records the app has given
up on. That survives as the waiting row `२ नोंदी पाठवता आल्या नाहीत`, phrased as work.

> **Binding constraint:** the honesty module (`syncHonestyState.ts`) exists because the previous chip
> latched on amber "Sending…" forever and once showed `पाठवलं ✓` for records no code path would ever
> send. **Removing the chip must not remove the app's ability to say a record has NOT reached the
> server.** That statement moves into the waiting drawer; it does not disappear.

**Transience rule:** sync state changes in seconds; the drawer is for durable unresolved things.
Surface only what is **stuck** — `NEEDS_FIX` always; in-flight is silence.

### 4.2 From above the plot selector on the home screen

| Removed | Where it goes |
|---|---|
| Large weather card | 70px chip; tap opens the same card underneath |
| Daily Closure card (ring, "Day Not Closed", Close Day, task counts, "Pending approvals: N") | waiting drawer |
| Yesterday-not-closed block | waiting drawer |
| "Cost may be inaccurate — N unverified" | waiting drawer |
| Running Cost numbers | **below** the plot selector |
| "Daily Log" heading + owner chip | redundant — the header already shows the owner |

**≈380px returned** to the thing the screen exists for.

**Running Cost ruling — split it.** The numbers are ambient status → below the action, where they
read as a reward. The *"cost may be inaccurate"* half is the same fact as "N need your approval",
written a third time → into the drawer.

> **The rule that keeps the count meaningful: the drawer holds only what is *unresolved and
> actionable*. Never what is merely true.**

---

## 5. THE HOME SCREEN

Order, locked:

1. Header + canonical strip (§2)
2. **The plot selector** — `CropSelector`, **untouched**
3. Running cost / day progress — ambient, below
4. Record bar — pinned above the navigation

### 5.1 CropSelector is not to be redesigned

Reproduce nothing, change nothing: the horizontal snap-scroll carousel, the 144px `rounded-[2.5rem]`
photo cards, `scale-110` + coloured ring + blurred glow on select, the hanging tick badge at
`-bottom-5`, the focus-dim on unselected cards, the dark plot tray with numbered circles and
"Ready to Log".

**Its heading already says what was wanted** — *"Select the plots you worked on today"* with the
bouncing pin, plus the sub-line about multiple crops or plots. Do not rewrite it.

Preserve: multi-plot selection · Entire Farm · crop-wise grouping · **never auto-select the last-used
plot** · never infer the plot from voice · never bypass context selection.

### 5.2 Two taps, and both always reachable

**Tap 1** a plot. **Tap 2** the record bar.

The record bar is **pinned above the navigation** so it never scrolls away. Grey before a plot is
chosen, saying what to do first; emerald and active the moment one is.

**Measured constraint:** with the plot tray open the real `CropSelector` needs 767px against 571px of
visible screen. **Do not shrink the component.** Auto-scroll the tray into view on crop select —
behaviour, not design.

### 5.3 Numbered steps are earned here

① on the question, ② on the record bar. The content genuinely **is** a sequence — context first,
speech second — and the order is not optional, because the parser needs the plot to sort what he
says. ① becomes a green tick on selection.

---

## 6. MARATHI — THE HARD RULE

**No agent may invent farmer-facing Marathi.** A previously invented string shipped with the word
order inverted; a farmer who dropped 2 of 3 records would have been told he dropped "3 of 2". It
compiled and passed every test.

### 6.1 Already in the repo — reuse verbatim

From `dfesTranslations.ts`, the **"Owner verification trigger"** block — written and never wired:

| Key | String |
|---|---|
| `welcomeBack` | पुन्हा स्वागत! शेतात काय चाललं? |
| `weeklyReviewPrompt` | तुमच्या शेतनोंदीत नवीन नोंदी आहेत. तपासा. |
| `farmBookOpen` | या आठवड्याची शेतनोंद उघडी आहे. |
| `todayClosed` | आजचं आटपलं. सगळी कामे आणि गोष्टी समजल्या |
| `needsReview` | तपासायचे आहे |
| `unknown` | अज्ञात |
| `activitiesLogged` / `entries` | कामे नोंदवली / कामे |

Plus `तुमच्या शेती`, `शेती तयार करा`, `QR ने जोडा` (FarmSwitcherSheet), `लक्ष द्या` and
`सगळ्या शेती आज व्यवस्थित आहेत` (AttentionPage), `मंजूर करा` (PII review).

### 6.2 NOT approved — placeholders only, founder must supply

Every one of these is an agent construction. They ship as **i18n keys with the English fallback
visible**, and are flagged in the PR for the founder to fill:

| Concept | Placeholder used in the mock |
|---|---|
| The waiting row label | तुम्हांसाठी बाकी |
| The rest state | काही बाकी नाही |
| The Seen control | मी हे पाहिलं |
| The decision line | ६ कामे तपासायचे आहे |
| The delegated line | ६ कामे — गणेश मुकादम ठरवतील |
| Failed sends | २ नोंदी पाठवता आल्या नाहीत |
| Record bar (idle / active) | आधी प्लॉट निवडा / बोला |

**The Seen label must not carry `मंजूर` (approve) or `खात्री` (confirm)** — both already mean a
decision in this app.

---

## 7. THE CONDITION THAT DECIDES WHETHER THIS WORKS

`VerificationRecord.required` already exists (`log.types.ts:561`). **It must stay rare** — money over
a threshold, disputes, out-of-pattern records.

If every record requires approval, the decision count never reaches zero. A count that never zeroes
stops being read within a fortnight — **and that blindness spreads to the crop warnings beneath it.**
This is the single failure mode that cannot be patched later.

**No badge on the bottom-nav tab.** Work is recorded most days, so an unseen badge would be lit
almost every day, which is the same failure in a smaller package.

---

## 8. SCOPE BOUNDARIES

**In scope:** the canonical strip · the waiting drawer · the home-screen reorder · removing the sync
chip from the header · the single real permission grant.

**Explicitly not in scope:**

- Push notifications — in-app only in V1
- A notification bell — founder-rejected; no new icon, no new gesture
- Moving the Attention tab; it keeps its own meaning (crop and plot health)
- Redesigning `CropSelector`, the `FarmSwitcherSheet`, the approval flow, or Reflect
- A second approval system — reuse the existing one
- Expense-verification governance (§P-E)
- Changing stored shape or sync behaviour without agreeing it with the server-authoritative lane

### 8.1 Lane coordination — binding

The durable server-side checkpoint (a new `FarmMembership` column + its endpoint) **changes stored
shape**, which is the server-authoritative lane's territory by the founder's own boundary test.

**Therefore this spec splits the work:**

- **Client (this lane, now):** an `OversightAcknowledgementPort` with a **local** adapter, so the
  loop is complete and previewable end-to-end.
- **Server (coordinated, next):** the additive column on `farm_memberships` and a self-scoped
  endpoint copied from `PUT /farms/{farmId}/labour-permissions/{targetUserId}` — deliberately **not**
  through `/sync/push`, which sidesteps the strict allow-list, the three payload copies, and the
  read-back ordering trap.

**The port boundary is the whole point:** swapping the adapter must require no UI change.

**The read side depends on the other lane too.** "What arrived since the checkpoint" needs a
trustworthy per-record server timestamp, and §P0.5 of their plan records that `batchSave()` currently
erases `serverModifiedAtUtc` on every save. Until that lands, the client falls back to a stated,
visible approximation — **it never fabricates a boundary**.

### 8.2 Branch

Built on `feat/owner-oversight-loop`, cut from `feat/labour-management-ui` because the permission
foundation exists nowhere else yet. **Rebase onto updated `main` once labour merges** — mechanical,
and required before any merge of this lane.

---

## 9. DEFINITION OF DONE

1. The strip renders identically on **Log, Reflect and Compare**, and does not move between them.
2. The farm chip opens the existing sheet; switching farms updates the chip.
3. The waiting count is **derived** from real records; no literal in any component.
4. Tapping Seen clears the informational band and **leaves every decision row in place** — proven by
   a named test, not by inspection.
5. The Seen control is **not** emerald — asserted by a test, because this is a colour-carried rule.
6. Records with no captured creator render as **अज्ञात** and are excluded from the people tally.
7. The sync chip is gone from the header, and `NEEDS_FIX` still reaches the farmer via the drawer.
8. The home screen shows the question, all plot choices and the record bar **without scrolling** at
   390×844.
9. `CropSelector`'s rendered output is **unchanged** — asserted against its existing tests.
10. Every unapproved Marathi string is an i18n key with a visible English fallback, listed in the PR.
11. `npm run typecheck`, `lint`, `check:file-sizes` and `test` all pass; a dev server renders the
    result for founder preview.
