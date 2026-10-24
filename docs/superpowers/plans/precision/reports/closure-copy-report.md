# Closure — farmer-facing copy corrections

**spec:** 2026-08-28-labour-v2-release-1
**Branch:** `feat/labour-v2-r1` · **Base:** `af9fe23e` · **Date:** 2026-09-03
**Scope:** presentation vocabulary only. No database rename, no migration, no namespace
churn, no test-class rename, no new economic model, no Contract V1, no new permission, no
change to attendance truth / Mukadam authority / offline sync.

---

## The rule applied

Founder, 2026-09-03: *"Describe the work arrangement. Never classify the human."* Internal
names (`LabourAssignment`, `LabourManagementPermission`, `FieldOperator`, `ContractUnit`,
`RojandariStated`, the `labour` route, every test class and DB column) are **untouched by
design** — presentation and internal vocabulary are allowed to diverge, and that divergence
is the founder's explicit instruction, not an accident to be cleaned up later.

Two things had to go from farmer-reachable copy:

1. **"Labour" / "Labour Management"** — in English, and in its Marathi form
   `कामगार व्यवस्थापन`, which is both a literal translation of "Labour Management" and a
   noun that names a **class of person** (`कामगार`).
2. **`रोजंदारी` as a visible category** — it names the **basis on which the farmer is
   obligated to pay**, and had begun to read as a kind of human, most sharply in
   `N रोजंदारी · N उक्ते`, which counts **people** under a payment word.

`उक्ते काम` is untouched throughout. It already describes the work arrangement.

**No permanent name was invented.** Everything below is provisional wording for this release;
the founder's naming session owns decisions N1–N15 in the audit.

---

## Every string changed (before → after)

### 1 · The subsystem's name on farmer surfaces — provisional `कामाच्या नोंदी`

"The records of the work." Work-centred, names no human, is not a brand, and is built from
two words already live in this feature (`काम`, `नोंदी`).

| # | File:line | Before | After |
|---|---|---|---|
| 1 | `features/labour/components/LabourFeature.tsx:59` (hub screen title) | `कामगार व्यवस्थापन` | `कामाच्या नोंदी` |
| 2 | `features/profile/components/SetupHubMenu.tsx:286` (the one door in) | `कामगार व्यवस्थापन · Labour` | `कामाच्या नोंदी` |
| 3 | `core/navigation/mainViewComponents.tsx:98` (banner `aria-label`) | `कामगार व्यवस्थापनाकडे परत जा — back to Labour Management` | `कामाच्या नोंदींकडे परत जा — back to the work records` |
| 4 | `core/navigation/mainViewComponents.tsx:105` (banner headline) | `कामगार व्यवस्थापनासाठी नोंद` | `कामाच्या नोंदींसाठी` |
| 5 | `core/navigation/mainViewComponents.tsx:114` (banner back-pill) | `कामगार व्यवस्थापन` | `कामाच्या नोंदी` |
| 6 | `features/labour/components/LabourHub.tsx:450` (help-note label) | `कामगार व्यवस्थापन कसं वापरायचं?` | `हे कसं वापरायचं?` |

Three deliberate shapes inside that set:

- **#4 is a deletion, not a substitution.** "कामाच्या नोंदींसाठी नोंद" stutters (`नोंद`
  twice), so the trailing noun was dropped. Same move Task 7 made on this same banner:
  delete rather than invent. The banner's subtitle still supplies the verb.
- **#2 drops the English half rather than translating it.** The other Setup Hub rows are
  `mr · en` pairs. Any English noun chosen here would be a new name, and the naming session
  owns that. The row is Marathi-only until then. Its subtitle `मजुरी` is untouched, so the
  Task 7 (`हजेरी`) and Task 7b (`उचल`) honesty deletions still stand and their tests still
  pass unchanged.
- **#6 drops the subsystem noun entirely** instead of repeating a provisional one. The
  farmer is already on the screen; "this" is unambiguous.

### 2 · The day-rate half of the money pair — provisional `दिवसाच्या हिशोबाने`

"Settled by the day." States the settlement basis; classifies nobody. This is the founder's
own provisional illustration, used verbatim.

| # | File:line | Before | After |
|---|---|---|---|
| 7 | `features/labour/components/LabourHub.tsx:355` (money card title, owner view) | `रोजंदारी` | `दिवसाच्या हिशोबाने` |
| 8 | `features/labour/components/LabourHub.tsx:379` (headcount breakdown) | `{n} रोजंदारी` | `{n} दिवसाच्या हिशोबाने` |

The card's sub-label `नोंदलेली` is unchanged, as is the whole `उक्ते काम · ठरलेली` card
beside it. The headcount line keeps its shape and keeps the count whole:

```
आज कामावर 12 जण — 4 दिवसाच्या हिशोबाने · 8 उक्ते
```

`12` is still the whole farm; `4` and `8` are still a breakdown, not a filter (they need not
sum to 12, and an unknown part still renders nothing rather than `0`). Only the words
changed — no arithmetic, no field, no null-handling.

One presentational touch came with #7: `leading-tight` on that card title, because the new
phrase wraps to two lines in a half-width card where `रोजंदारी` did not.

### 3 · The last English "Labour" on a farmer screen

| # | File:line | Before | After |
|---|---|---|---|
| 9 | `features/logs/components/manual-entry/components/LabourReview.tsx:67` (pre-save panel eyebrow) | `Labour Review` (hardcoded English) | `{t('workSummary.workBreakdown')}` → `कामाचा तपशील` / `Work Breakdown` |

Nothing invented: `workSummary.workBreakdown` is already-shipped, founder-approved,
language-aware copy, reused exactly the way `workSummary.labour` is reused two elements
below it. Task 21 had left this eyebrow in English pending a founder ruling; the vocabulary
rule *is* that ruling for the "Labour" half, and a reusable replacement existed.

### 4 · Server-side doc comment corrected so it does not describe deleted copy

`ShramSafal.Application/Contracts/Dtos/LabourDataDto.cs` — the `LabourHomeDto` XML docs
quoted the UI copy verbatim (`(रोजंदारी · नोंदलेली)` and
`"आज कामावर N जण — x रोजंदारी · y उक्ते"`). Both quotes updated to the new wording, plus a
`<para>` recording that **`RojandariStated` / `RojandariToday` are internal and stay**. No
wire field, no column, no migration, no behaviour change — comment text only.

`GetLabourDataHandler.cs` was **left alone**: its `रोजंदारी` occurrences are the founder's
own corrected economic model stated as a concept, not quotations of screen copy.

---

## Tests updated to assert the new strings

| File | Change |
|---|---|
| `features/labour/components/__tests__/HajeriLedgerTotals.test.tsx:312,318` | now asserts `दिवसाच्या हिशोबाने` and `4 दिवसाच्या हिशोबाने`, **plus a new negative** `not.toContain('रोजंदारी')` so the old word cannot come back on the money card or the breakdown |
| `features/labour/components/__tests__/LabourHub.test.tsx` (×6) | help-note opener is now `हे कसं वापरायचं?` |
| `features/profile/components/__tests__/SetupHubMenu.test.tsx:33,49` | row label is now `कामाच्या नोंदी`; the two honesty assertions (`queryByText(/हजेरी/)` null, `queryByText(/उचल/)` null, subtitle keeps `मजुरी`) are untouched and still pass |
| `core/navigation/__tests__/labour-log-banner.test.tsx:66` | aria-label now contains `कामाच्या नोंदी` |

Two stale comments were corrected because the copy they described no longer exists:
`LabourReview.tsx` and `LabourReview.test.tsx` both said the eyebrow was "intentionally left
in English pending a founder ruling". They now say what actually happened, and both still
record that the `Total workers: N` line beneath it is *still* pending.

---

## The Phase 5 vocabulary scan now bans farmer-facing "Labour"

`features/labour/__tests__/farmerVocabulary.scan.test.ts` — the existing scan (Devanagari
string literals + JSX text nodes, comments stripped) gained:

- `const FARMER_FACING_LABOUR = /\blabour\b/i;`
- `SUBSYSTEM_DOORS` — the three farmer-reachable surfaces that name this subsystem from
  **outside** `features/labour/`: `SetupHubMenu.tsx`, `mainViewComponents.tsx`,
  `LabourReview.tsx`. Every one of them said "Labour" in English until today.
- two new `it` blocks: one asserting all three doors exist (a moved door must break the scan
  loudly, not hollow it out), one asserting no farmer-facing string says "Labour" across the
  feature **and** its doors.

The doors are scanned for the **Labour ban only**, deliberately not for the permission ban:
D5's handover copy is scoped to the two authority surfaces, and widening *that* scope is
founder decision **N10**, not this release.

**The Marathi half is deliberately not regex-pinned.** A ban on `कामगार` would also ban the
role label (`roleLabels.ts`), the day-ledger cost category (`workSummary.labour`), the
settings sections and the empty states — all of which this release leaves alone on purpose.
The English word has no such ambiguity, so that is what is pinned.

**Negative control run.** Re-inserting `· Labour` into the Setup Hub row made the new test
fail (`1 failed | 3 passed`); reverting made it pass again (`4 passed`). The ban is real,
not decorative.

---

## Deliberately left for the naming session — flagged, not replaced

Per the rule ("flag ambiguous `मजूर` / `कामगार` occurrences — do NOT invent replacements"):

| Left as-is | Where | Audit decision it belongs to |
|---|---|---|
| `N मजूर` (the countable-worker chip) | `LabourDataPoints.tsx`, `LabourHub.tsx`, `ReviewSheet.tsx`, `LabourReview.tsx` | **N2** |
| `Total workers: N (…)` | `LabourReview.tsx` — the line under the eyebrow I did change | **N2 / N15** |
| `हजेरी · मजूर · मजुरी बोला` | `mainViewComponents.tsx:110` — banner subtitle, contains `मजूर` | **N2** |
| `कामगार` as a screen-title fallback, a farm role, a QR role, an operator chip, a cost category, settings sections, empty states | `LabourFeature.tsx:61`, `roleLabels.ts`, `TeamMemberCard.tsx`, `JoinFarmLandingPage.tsx`, `OperatorSessionChip.tsx`, `i18n/translations.ts`, `IdentitySection.tsx` | **N2 / N15** |
| `Labour` as the **en** value of `workSummary.labour` in `i18n/translations.ts` | the day-ledger cost category, shared far beyond this feature | **N15** — out of scope; changing a shared i18n value is not a labour-copy correction |
| `Daily Wage / Contract / Self`, `Per Tree / Per Acre / Per Row / Lump Sum`, `Unit`, `Total Contract Amount (₹)` | `DetailSheet.tsx` — the same economic split stated in a wholly different English vocabulary | **N15**, and it depends on **N3**, which the founder has now half-answered; the rest is his session |
| `मजुरी` in its four different roles; `काम झालं` as a money label; `मुकादम`'s three referents; `तात्पुरता`; `फक्त नाव`; `टीम` vs `संघ`; the `उचल` family; `विश्वास` / reliability vocabulary | throughout | **N4, N6, N7, N8, N9, N11, N13** |

Nothing in that table was touched. Each is a real naming decision with more than one
defensible answer, and inventing one here would pre-empt the session that owns it.

---

## Gate — verbatim

```
TSC_0_ERRORS                                                    # npx tsc --noEmit -p tsconfig.json

Test Files  47 passed (47)                                      # vitest: src/features/labour
     Tests  519 passed (519)                                    #   + labour-log-banner + SetupHubMenu
                                                                #   + manual-entry (LabourReview)

✓ farmerVocabulary.scan.test.ts > the scan scope is non-empty
✓ ... > no farmer-facing labour string contains permission vocabulary or a hardcoded English ON/OFF
✓ ... > every subsystem door is present in the scan
✓ ... > no farmer-facing string says "Labour" — not in the feature, not on its doors
Test Files  1 passed (1) · Tests  4 passed (4)

Passed! - Failed: 0, Passed: 2005, Skipped: 1, Total: 2006      # ShramSafal.Domain.Tests
Passed! - Failed: 0, Passed:  107, Skipped: 0, Total:  107      # AgriSync.ArchitectureTests

dotnet format src/AgriSync.sln --verify-no-changes  -> clean
```

Category=RequiresDocker excluded, matching CI. No `--no-verify`. `sync-contract/` untouched.

**Line-ending note.** The first `dotnet format` run reported 106 WHITESPACE errors in
`LabourDataDto.cs` — my editing script had written the file LF where the working tree is
CRLF (`core.autocrlf=true`). The file was rewritten with CRLF and format is clean; the same
restoration was applied to all eleven edited web files. Git's diff is unaffected either way,
but the mixed state would have tripped the pre-commit hook.

---

## What a farmer sees now

```
Setup Hub row     कामाच्या नोंदी
                  मजुरी

Hub title         कामाच्या नोंदी

Money cards       दिवसाच्या हिशोबाने        उक्ते काम
                  नोंदलेली                  ठरलेली
                  ₹4,650                    ₹12,000

Headcount         आज कामावर 12 जण — 4 दिवसाच्या हिशोबाने · 8 उक्ते

Help note         हे कसं वापरायचं?

Log banner        कामाच्या नोंदींसाठी
                  हजेरी · मजूर · मजुरी बोला          <- मजूर flagged, not touched (N2)
                  <- कामाच्या नोंदी
```

No screen classifies a person by how his work is paid for. `उक्ते काम` still describes an
arrangement. Every number on that hub still comes from something the farmer actually stated,
and `—` still means "we were not told".
