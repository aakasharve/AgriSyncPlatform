# Labour V2 R1 — CURRENT TRUTH INDEX

**spec:** 2026-08-28-labour-v2-release-1
**Branch:** `feat/labour-v2-r1` · **Written at HEAD:** `0a9569ea` · **Date:** 2026-09-04
**Status:** NAVIGATION AND PRECEDENCE ONLY. No production code, copy, name, key or
identifier was changed by this document, and **no historical file was edited to make
history look current**. Every claim below was verified by reading the named file at the
named line on this tree.

## Why this file exists

The handover package now holds several generations of decisions, and more than one of them
says "BINDING" at the top. A reader who opens two of them in the wrong order will build the
wrong thing — most sharply on farmer-facing words, where the 2026-09-02 founder master
review and the 2026-09-03 dignity ruling say different things about the same money card.

This file does not add a decision. It says **which existing document wins**, and names the
exact sentences that have been overtaken. It is the first file to read and the shortest.

**It is not the vocabulary audit.** `farmer-facing-vocabulary-audit.md` (453 farmer-facing
strings, 259 unique terms, founder decisions N1–N15) is the term inventory and is not
repeated here. This file adds the two things that inventory deliberately does not carry: the
**precedence order** between the documents, and the **superseded set**.

---

## 1. PRECEDENCE TABLE — highest authority first

| # | Authority | Path (repo-relative) | What it settles | In git? |
|---|---|---|---|---|
| **1** | **The 2026-09-03 closure section** — `# Closure round — 2026-09-03`, i.e. **line 339 to end of file** | `docs/superpowers/plans/precision/phase-5-walk-evidence.md` | The exact HEAD that merges: the economic model, farmer vocabulary, the membership verdict, the manual door, release size, final CI | yes |
| **2** | Closure — economic report | `docs/superpowers/plans/precision/reports/closure-economic-report.md` | What makes an engagement उक्ते rather than day-rate (`IsUkte`), the seven founder cases A–G, and three findings left open | yes |
| **3** | Closure — copy report | `docs/superpowers/plans/precision/reports/closure-copy-report.md` | Every farmer-facing string changed on 2026-09-03, before → after, and everything deliberately left for the naming session | yes |
| **4** | Closure — membership report | `docs/superpowers/plans/precision/reports/closure-membership-report.md` | What the six membership statuses can read today, why nothing was changed, and the buried question for the founder | yes |
| **5** | The 2026-09-02 founder master review — **ONLY where not superseded** | `docs/superpowers/mockups/2026-09-01-labour-r1/DECISIONS-2026-09-02-founder-master-review.md` | His D1–D7: the clean register, the authority handover, the two money truths, the numerals convention, and the harvested Marathi (lines 91–106) | yes |
| **6** | The phase plans and the governing specs | `docs/superpowers/plans/precision/phase-2-authority.md`, `phase-3-capture.md`, `phase-4-register.md`, `phase-5-acceptance.md`, and `phase-5-walk-evidence.md` **lines 1–337**; `docs/superpowers/handoffs/2026-08-28-LABOUR-V2-LOCKED-DECISIONS.md` (D1–D16); `docs/superpowers/specs/2026-08-31-hajeri-design-decisions.md` (D-H1–D-H10); `docs/superpowers/plans/2026-09-01-labour-v2-r1-*.md` | Architecture, data model, task contracts, test contracts. Binding for **mechanism** | yes |
| **7** | Old mockups and review packages — **HISTORICAL implementation evidence, not current copy** | `docs/superpowers/mockups/2026-09-01-labour-r1/**` (19 files); `docs/superpowers/plans/precision/reviews/*.txt` (23 files); `docs/superpowers/plans/precision/reports/task-*.md` (25 files) | What a screen looked like, and what was reviewed, on the day it was drawn. **Never** a source of copy | mockups yes; `reviews/` and the `task-*` reports are **untracked — this worktree only** |

**Two cautions about this table.**

**(a) Rank 1 and rank 6 are the same file.** `phase-5-walk-evidence.md` carries two
generations. Lines 1–337 are the pre-closure acceptance walk; lines 339–426 are the closure
section. Where they disagree, **the closure section wins over its own earlier pages** — see
§3.2, where a footnote in the file's own rank-6 half is superseded by §2 of its rank-1 half.

**(b) The same closure round produced two more reports** that the closure section names:
`reports/closure-doors-report.md` (evidence for closure §4, the manual door) and
`reports/closure-stats-report.md` (evidence for closure §5, the two release-size bases). They
carry the same date and the same authority *for their own sections only*; they settle nothing
about copy, vocabulary or the economic model.

---

## 2. RULING A — the `[FOUNDER COPY REQUIRED]` and `[COPY]` mockups are HISTORY

> **A `[FOUNDER COPY REQUIRED]` or `[COPY]` badge in a mockup is NOT an open question and is
> NOT current farmer-facing copy. It is a snapshot of a design taken before the founder
> supplied the words. Do not build from it. Do not ask the founder to fill it in again.**

**Measured on this tree (`git grep`, tracked files only):**

| Marker | Occurrences | Files |
|---|---|---|
| `[FOUNDER COPY REQUIRED]` | **141** | **20** — 17 under `docs/superpowers/mockups/2026-09-01-labour-r1/` plus `plans/2026-09-01-labour-v2-r1-PHASE0-FINDINGS.md` (2), `-REVISION-1.md` (2), `-human-execution-layer.md` (2) |
| `[COPY]` | **49** | **7**, all under the same mockup folder |
| Either marker **anywhere in `src/`** | **0** | **0** — no placeholder was ever shipped |

Heaviest: `INTEGRATED-labour-system-and-new-ideas.html` (35 + 23),
`04-state-d-contradiction.html` (15), `07-allow-labour-management.html` (14),
`frag-1-capture.html` (13), `frag-5-time.html` (2 + 17).

**Why they are still there, and why that is correct.** The founder answered them on
2026-09-02 by supplying the Marathi in his own file, not by editing ours. The master review
records the resolution under *"Marathi copy harvested from his file (now APPROVED — no longer
placeholders)"* (lines 91–106), and the plan records the closure at
`2026-09-01-labour-v2-r1-human-execution-layer.md:118`: **"No [FOUNDER COPY REQUIRED] remains
for R1 surfaces."** The mockups were left untouched **on purpose** — they are the design
record of that day, and rewriting them would destroy the evidence that the question was ever
asked.

**Where to look instead, in order:** ranks 1–4 above → then the master review's harvested list
(lines 91–106) → then the string as it actually exists in `src/`, which §3.1 indexes for
everything the dignity ruling touched.

---

## 3. RULING B — the 2026-09-03 dignity ruling SUPERSEDES the earlier D6 रोजंदारी wording

The founder's rule, quoted at `closure-copy-report.md:14`: *"Describe the work arrangement.
Never classify the human."*

`रोजंदारी` names the **basis on which the farmer owes money**. On the hub it had begun to read
as a **kind of person** — sharpest in `N रोजंदारी · N उक्ते`, which counts *people* under a
payment word. That wording was approved on 2026-09-02 and **replaced on 2026-09-03**.
`उक्ते काम` is untouched: it already describes an arrangement, not a human.

### 3.1 The exact superseded strings, and their replacements

Verified in the tree at HEAD `0a9569ea`. Line numbers are **current**, and differ from those
in `closure-copy-report.md` because that report recorded pre-edit lines and explanatory
comments were added with the change — search for the string, not the line.

| # | Screen the farmer is on | Superseded string (approved 2026-09-02) | Current string (2026-09-03) | Verified at |
|---|---|---|---|---|
| 1 | Work-records hub, back-header title | `कामगार व्यवस्थापन` | `कामाच्या नोंदी` | `features/labour/components/LabourFeature.tsx:73` |
| 2 | Setup Hub — the one door in | `कामगार व्यवस्थापन · Labour` | `कामाच्या नोंदी` (subtitle `मजुरी` unchanged) | `features/profile/components/SetupHubMenu.tsx:295` |
| 3 | Log page, banner `aria-label` | `कामगार व्यवस्थापनाकडे परत जा — back to Labour Management` | `कामाच्या नोंदींकडे परत जा — back to the work records` | `core/navigation/mainViewComponents.tsx:98` |
| 4 | Log page, banner headline | `कामगार व्यवस्थापनासाठी नोंद` | `कामाच्या नोंदींसाठी` — the trailing `नोंद` is **deleted**, not substituted (it stuttered) | `core/navigation/mainViewComponents.tsx:110` |
| 5 | Log page, banner back-pill | `कामगार व्यवस्थापन` | `कामाच्या नोंदी` | `core/navigation/mainViewComponents.tsx:119` |
| 6 | Hub help-note toggle | `कामगार व्यवस्थापन कसं वापरायचं?` | `हे कसं वापरायचं?` — the subsystem noun is dropped, not renamed | `features/labour/components/LabourHub.tsx:467` |
| 7 | Hub money card, owner view | `रोजंदारी` | `दिवसाच्या हिशोबाने` | `features/labour/components/LabourHub.tsx:364` |
| 8 | Hub headcount breakdown | `{n} रोजंदारी` — e.g. `आज कामावर 12 जण — 4 रोजंदारी · 8 उक्ते` | `{n} दिवसाच्या हिशोबाने` — `आज कामावर 12 जण — 4 दिवसाच्या हिशोबाने · 8 उक्ते` | `features/labour/components/LabourHub.tsx:391` |
| 9 | Manual entry, pre-save panel eyebrow | `Labour Review` (hardcoded English) | the already-shipped `workSummary.workBreakdown` → `कामाचा तपशील` / `Work Breakdown` | `features/logs/components/manual-entry/components/LabourReview.tsx:80` |

All client paths are under `src/clients/mobile-web/src/`. Rows 1–9 are the complete
farmer-facing set changed by commit `83d012ec`. The tenth edit in that commit is a server
**doc comment** (`ShramSafal.Application/Contracts/Dtos/LabourDataDto.cs`) that had quoted the
deleted copy verbatim — comment text only: no wire field, no column, no behaviour.

**The arithmetic did not change.** `12` is still the whole farm; `4` and `8` are still a
breakdown and not a filter (they need not sum to 12), and an unknown part still renders
nothing rather than `0`. Only the words moved. The sibling card
(`उक्ते काम` / `ठरलेली`, `LabourHub.tsx:369`) was not touched.

**Pinned, not merely edited.** `features/labour/__tests__/farmerVocabulary.scan.test.ts`
gained `/\blabour\b/i` plus three named subsystem doors outside `features/labour/`
(`SetupHubMenu.tsx`, `mainViewComponents.tsx`, `LabourReview.tsx`), and
`HajeriLedgerTotals.test.tsx:317` asserts `not.toContain('रोजंदारी')`. Re-inserting
`· Labour` turns the scan red — negative control run and recorded in `closure-copy-report.md`.

**Deliberately NOT pinned:** the Marathi half. A regex ban on `कामगार` would also ban the role
label, the day-ledger cost category, the settings sections and the empty states, all of which
this release leaves alone on purpose.

### 3.2 Sentences that still state the superseded wording as binding — READ AS HISTORY

Not one of these is wrong about its own date. Every one of them is wrong as a description of
what a farmer reads today. **None of them may be edited** — they are the record.

| Where the stale wording still stands | Line(s) | What it says | Read instead |
|---|---|---|---|
| `mockups/2026-09-01-labour-r1/DECISIONS-2026-09-02-founder-master-review.md` (**rank 5**) | 21, 67, 75, 103 | D6: `रोजंदारी · नोंदलेली ₹…`; `आज कामावर 12 जण — 4 रोजंदारी · 8 उक्ते`; "D6 set: **रोजंदारी · नोंदलेली**" | §3.1 rows 7–8. Everything else in D6 — two cards never combined, the aggregation boundary, farmer-stated progress — **still binds** |
| `plans/precision/phase-5-walk-evidence.md` (**its own rank-6 half**) | 321–324 | *"Footnote on the D6 breakdown: … the home line may say 'x रोजंदारी' … Copy stands unless the founder wants a third word for 'unstated'"* | The same file's closure §2 (from line 368). The copy did **not** stand. The *underlying* question — a word for an arrangement nobody voiced — is still open (§5, item 6) |
| `plans/2026-09-01-labour-v2-r1-human-execution-layer.md` | 100–101 | *"Money lives on the Labour home as TWO cards — रोजंदारी नोंदलेली and उक्ते ठरलेली"* | The two-card rule holds; the day-rate card's **word** is §3.1 row 7 |
| `plans/precision/phase-4-register.md` | 11, 157, 2472, 2495–2496, 2569, 2577, 2686, 2698, 2710, 2732, 2738, 2771 | Verbatim JSX, C# doc comments, test assertions and a commit message, all carrying `रोजंदारी` as farmer-facing copy | **The highest-risk file in the package** — its code blocks are copy-pasteable and would reintroduce the word. The mechanism it specifies is correct; its display strings are not |
| `mockups/2026-09-01-labour-r1/` — `INTEGRATED-…html` (10), `frag-6-contract.html` (5), `DECISION-money-vs-contract.html` (3), `frag-7-together.html` (2), `index.html` (1), `_TOKENS.md` (1) | — | Drawn screens showing `रोजंदारी` on the money card | §3.1, and Ruling A |
| `plans/precision/reviews/task-4.8-package.txt` (10 hits), `task-3.5-package.txt`, `task-4.5-package.txt` | — | Source snapshots taken at review time, carrying the then-current copy | Ruling A. These files are **untracked** and exist only in this worktree |

The one `Rojandari*` name deliberately **kept** is internal — see Ruling C.

**Not stale, no warning needed:** `plans/precision/followup-manual-attendance-door.md:180,185`
already states the corrected rule (basis of the obligation; never a visible category of
person).

---

## 4. RULING C — internal `Labour*` identifiers are UNCHANGED and remain valid

> **The 2026-09-03 change was a presentation change only. Not one internal name moved.
> Presentation and internal vocabulary are allowed to diverge, and that divergence is the
> founder's explicit instruction — not debt to be tidied up later.**

Recorded at `closure-copy-report.md:12-17` and in the commit body of `83d012ec`. Measured on
this tree:

| Internal name | Still in use | Evidence |
|---|---|---|
| `LabourAssignment` | **158 files** | `git grep -l LabourAssignment -- src` |
| `FieldOperator` | **116 files** | `git grep -l FieldOperator -- src` |
| `LabourManagementPermission` | **10 files** | `git grep -l LabourManagementPermission -- src` |
| `RojandariStated` / `RojandariToday` | DTO and wire, unchanged | `LabourDataDto.cs` — the corrected doc comment records explicitly that they are internal and **stay** |
| `ContractUnit`, `LabourEngagementType`, `AttendanceMark`, `LabourAnchor`, the `labour` route, every test class, every DB column and migration | unchanged | no rename, no migration and no namespace churn in `83d012ec` or `af9fe23e` |

**Why the ban cannot reach them, by construction:** `farmerVocabulary.scan.test.ts` reads only
(i) string literals containing Devanagari and (ii) JSX text nodes, comments stripped first,
rooted at `src/clients/mobile-web`. Import paths, class names, `data-testid`s and attribute
values are outside its scope by design — and `docs/` is outside its roots entirely, which is
exactly why the mockups can carry stale copy without CI noticing, and why this index has to
exist instead of a test.

**Do not "finish the rename". There is no rename to finish.**

**But note what genuinely leaks** (audit §E-bis, unchanged by this release, owned by N15/N3):
`Operator` ("Switch Operator", "No operators added."), `ContractUnit` (the `Unit` select, and
Per Tree / Per Acre / Per Row / Lump Sum) and `LabourType` (rendered as the
`Daily Wage / Contract / Self` tab row) are internal words **on live farmer screens** in
`DetailSheet.tsx` and `OperatorSessionChip.tsx`. That is the same economic distinction as row
7 above, stated in a second, incompatible English vocabulary. It was left alone deliberately;
it is naming-session work, not a leftover of this change.

---

## 5. RULING D — `कामाच्या नोंदी` and `दिवसाच्या हिशोबाने` are PROVISIONAL

> **Neither word is a permanent name. Both are release wording, chosen to stop a farmer being
> classified by how his work is paid for. The naming session — decisions N1–N15 in
> `farmer-facing-vocabulary-audit.md` — owns the permanent vocabulary.**

`closure-copy-report.md:30-31`, verbatim: *"**No permanent name was invented.** Everything
below is provisional wording for this release; the founder's naming session owns decisions
N1–N15 in the audit."*

| Provisional word | Means | Why it was safe to ship now | Permanent decision that owns it |
|---|---|---|---|
| `कामाच्या नोंदी` | "the records of the work" | Built from two words already live in this feature (`काम`, `नोंदी`); work-centred; names no human; deliberately not a brand | **N1** — what this subsystem is called to a farmer |
| `दिवसाच्या हिशोबाने` | "settled by the day" | The founder's own provisional illustration, used verbatim; states the settlement basis and classifies nobody | **N3** — whether `रोजंदारी` may appear as a visible bucket of people |
| `हे कसं वापरायचं?` | "how do I use this?" | A **deletion** of the provisional noun rather than a second invention — the farmer is already on the screen | falls away once **N1** lands |

Also deliberately unresolved, and flagged rather than replaced by the same change: `N मजूर`,
`Total workers: N`, the banner subtitle's `मजूर`, every other `कामगार`, the shared `en` value
of `workSummary.labour`, and `DetailSheet`'s `Daily Wage / Contract / Self`. Each is a real
naming decision with more than one defensible answer.

**A trap inside the audit itself, worth knowing before you read it.**
`farmer-facing-vocabulary-audit.md` states its scan point in its own header: **`7219974d`** —
verified an ancestor of the copy commit `83d012ec`. So its Section A rows for these nine
strings (`कामगार व्यवस्थापन`, `रोजंदारी`, `Labour Review`) describe the screen **as it was on
the morning of 2026-09-03, before the dignity ruling landed**. Its inventory of the other
~250 terms, its collision analysis, its gap list and **its N1–N15 decision list are unaffected
and remain the owner of the permanent vocabulary.** Read Section A against §3.1 above; read
Section E as it stands.

---

## 6. What is genuinely still open — do not close these by reading a document

| # | Open item | Source | Who decides |
|---|---|---|---|
| 1 | **The membership read boundary.** `PendingOtpClaim`, `PendingApproval` and **`Suspended`** all reach the हजेरी register today, and a suspended `SecondaryOwner` receives the whole wage book. Nothing was changed: the smallest central fix touches eight other feature areas plus the RLS layer. The buried question is whether those statuses lose *everything* or only the *operational* surfaces — two predicates, not one | closure §3; `closure-membership-report.md` §1 and §3 | **Founder.** Named in the closure section as "the one item genuinely awaiting a founder decision" |
| 2 | **Three unfinished manual-हजेरी controls** behind the hard-`false` `SHOW_ATTENDANCE_TILE`: the save button reads `जतन करा → मंजुरीसाठी` with no approval step behind it; `आज किती लोक आली?` collects a number the save discards; `नाव जोडा` only raises a toast. Provably unreachable today and pinned shut by a test | `phase-5-walk-evidence.md` "Preview-door items"; `followup-manual-attendance-door.md`; `closure-doors-report.md` | Founder, **before the door opens** — all three, per Decision 4b |
| 3 | **`"vine"` is silently dropped** by `MapContractUnit`, so a per-झाड piece-rate job loses its unit on the way into the DB. One map entry would fix it; it changes what is WRITTEN, so it was left | `closure-economic-report.md` §7.1 | Founder: fix the map entry, or leave it |
| 4 | **The prompt teaches no lump-sum shape.** Nothing tells the model to emit `CONTRACT` for `"ठरलं ₹१५,००० ला"`. The read side is now correct *whenever* it does | `closure-economic-report.md` §7.2 | A follow-up prompt task (version bump + golden-set delta), not a closure edit |
| 5 | **`LabourEngagementType.Self`** — family or own labour — still lands on the day-rate money card. The founder's model is binary and has no third home | `closure-economic-report.md` §7.3 | Naming / Contract-V1 session |
| 6 | **A word for an arrangement that was never voiced.** Engagements whose arrangement was never stated bucket as day-rate by definition, so the home line can describe them with a word the farmer never said | `phase-5-walk-evidence.md:321-324`, re-scoped by closure §2 | Founder (optional gate copy item) |
| 7 | **N1–N15** — fifteen real naming decisions, including N1 and N3, which own the two provisional words above | `farmer-facing-vocabulary-audit.md` §E | The founder's naming session |
| 8 | **The Founder Acceptance Gate itself is unticked** (`phase-5-walk-evidence.md:284`). Code-complete ≠ approved; nothing merges without it | same | Founder |

---

## 7. How to keep this file true

1. **A new founder ruling is added as a new rank-1 row here, on the day it lands** — with the
   sentences it supersedes named, exactly the way §3.2 names them.
2. **Never edit a historical document to agree with a newer one.** The value of the mockups,
   the review packages and the master review is that they show what was true when they were
   written. Supersession is recorded *here*; it is never applied *there*.
3. **Verify before you cite.** Every line number in this file was read on `0a9569ea`. Line
   numbers drift when comments are added — search for the string, not the line.
4. **A note on doctrine's reading order.** `docs/AGRISYNC-DOCTRINE.md` §6 routes labour work to
   the Labour **V1** documents and the 2026-07-19 locked decisions; that list predates Labour
   V2 and does not route a reader to anything in §1 above. Doctrine's `P` rules still outrank
   every row of this table on matters of principle — this index orders the *feature* documents
   beneath them, and exists because §6's list alone will not get a reader here.
