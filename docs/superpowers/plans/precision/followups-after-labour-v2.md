# Follow-ups after Labour V2 R1 — the register of what must not be lost

**spec:** `2026-08-28-labour-v2-release-1` · branch `feat/labour-v2-r1` · written 2026-09-04

**What this file is.** Five items the founder ruled must survive the release, plus two
technical residuals recorded as accepted risks. Every claim below was re-verified against the
code on this branch; where the source report was imprecise, the correction is marked
**CORRECTION** and the report line it corrects is named.

**What this file is NOT.** It changes nothing. No production code, no farmer-facing copy, no
prompt, no schema, no test. Three of the five entries (E1, E2, T1) name a fix; none of them is
approved to be written. Two (E3, M1) are founder decisions with no implementation behind them.

**Sources it builds on — read, not repeated:**

| Source | What it already holds |
|---|---|
| `docs/superpowers/plans/precision/reports/closure-economic-report.md` §7 | The three findings deliberately left open by the रोजंदारी/उक्ते discriminator closure |
| `docs/superpowers/plans/precision/farmer-facing-vocabulary-audit.md` N11 | The reputation vocabulary already live on a named human, and the two strings asserting mechanisms that do not exist |
| `docs/superpowers/plans/precision/followup-manual-attendance-door.md` | The whole hand-off for the three unfinished capture controls — M1 points at it and does not restate it |

---

## E1 — `"vine"` is emitted by the normalizer and dropped by the mapper

### What it is

The piece-rate normalizer writes `contractUnit = "vine"` for a per-झाड job. The mapper that
turns that string into the stored enum does not know the word, so it stores `null`. A per-vine
piece-rate job loses its unit on the way into the database.

### Evidence (verified on this branch)

| Fact | File:line |
|---|---|
| Normalizer emits it | `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/DomainKnowledge/LabourWageModel.cs:151-152` — `if (VineUnitRegex().IsMatch(t)) contractUnit = "vine";` |
| Documented as intended output | `LabourWageModel.cs:21` (`झाड = vine, ओळ = row`), `:29-30` (`labour[].contractUnit ("vine" \| "row")`) |
| **Pinned by a test** — this is deliberate behaviour, not a typo | `src/tests/ShramSafal.Domain.Tests/AI/DomainKnowledge/LabourWageModelTests.cs:169` — `Assert.Equal("vine", contractUnit, ignoreCase: true)` |
| The write path reads that field | `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/LedgerDerivationService.cs:337` — `MapContractUnit(ReadString(item, "contractUnit"))` |
| The mapper does not know it | `src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/LabourAssignmentFactory.cs:152-159` — `tree / acre / row / lump sum`, then `_ => null` |
| `झाड` **is** the enum member | `src/apps/ShramSafal/ShramSafal.Domain/Farms/ContractUnit.cs` — `Tree` |
| It has never run for a farmer where the flag is unset | `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ParseVoiceInput/ParseVoiceInputHandler.cs:72` — `Ai:DomainKnowledgeLayer:Enabled`, default **false** |

**CORRECTION to `closure-economic-report.md` §7.1.** The report calls this "one map entry".
The map entry is correct and sufficient *server-side*, but it is not the only boundary that
rejects the value:

- The client's wire contract is **case-sensitive and capitalised** —
  `src/clients/mobile-web/src/domain/ai/contracts/AgriLogResponseSchema.ts:169`:
  `z.enum(['Tree', 'Acre', 'Row', 'Lump Sum'])`, applied to `contractUnit` at `:466`.
  The normalizer emits lowercase `"vine"` **and lowercase `"row"`** — so *both* of its outputs
  are out-of-contract at that boundary, not only the unmapped one. Server-side `MapContractUnit`
  lower-cases first (`Norm`, `LabourAssignmentFactory.cs:168-169`) and so tolerates `"row"`;
  the Zod enum does not.
- The consequence there is soft, not a discard: `AgriLogResponseSchema.safeParse` failing sends
  the **whole response** down the drift path — a `console.warn` plus
  `normalizeDriftedParsedLog(rawParsedLog)`
  (`src/clients/mobile-web/src/infrastructure/ai/BackendAiClient.helpers.ts:91,106-109`).
  What survives that normalization for this field is **not measured** and must not be assumed.

Also verified while checking this: `LabourWageModel`'s header documents a third wage model,
`"lump-sum"` (`:15`, `:29`), which **the code never emits** — only `"piece-rate"` and `"daily"`
are ever assigned (`:141-145`). And `wageModel` has **no consumer anywhere** — zero hits outside
`LabourWageModel.cs` across `src/apps` and `src/clients/mobile-web/src`. Whoever picks up E1
should not read that field as a signal; it currently goes nowhere.

### Why it is NOT in R1

It changes what is **WRITTEN**, not how what is written is read. R1's economic closure was
scoped to the read side (`IsUkte`), a different risk class. Its urgency is also genuinely lower
than it looks: a transcript that trips `VineUnitRegex` carries उक्त/ठेका, which drives the model
toward `type: CONTRACT`, and `IsUkte` (`GetLabourDataHandler.cs:844-846`) now catches that
through `EngagementType` regardless of the lost unit. The rate unit is lost; the उक्ते/रोजंदारी
verdict is not.

### What "done" looks like

- One entry in `MapContractUnit` mapping `"vine"` to `ContractUnit.Tree`, with a comment saying
  why the two words are the same thing (झाड).
- **One test.** Not a suite: `MapContractUnit("vine") == ContractUnit.Tree`, sitting next to the
  existing map tests.
- A decision — recorded, either way — on whether the client Zod enum's capitalisation mismatch
  is in scope. If it is not, say so in the commit; if it is, it needs its own measurement first
  (what actually survives `normalizeDriftedParsedLog`), and that is a separate task.
- **No Contract-V1 expansion.** No new enum member, no new column, no wire change, no
  re-litigating what a contract is. If the change starts needing a migration, it has left scope.

### Owner

A **narrow backend fix session** on the write path. Not the naming session — this is a mapping
bug with a settled answer, not a semantics question. Small enough to ride along with any other
`LabourAssignmentFactory` work.

---

## E2 — spoken whole-job / lump-sum contracts are UNMEASURED

### What it is

After R1, the read side is correct **whenever an assignment carries
`EngagementType = Contract`**. Whether the parser reliably produces that from a farmer saying a
fixed whole-job price — `"हे काम शंकरला 15 हजारात उक्ते दिलं"` — has never been measured.

**State this exactly as it is: unmeasured.** Not "the prompt is broken", not "the parser handles
it". Neither claim has evidence behind it.

### Evidence (verified on this branch)

| Fact | File:line |
|---|---|
| The read side is correct once `Contract` exists | `GetLabourDataHandler.cs:844-846` (`IsUkte`), applied at `:877-881` and `:1005` |
| `Contract` is reachable from the wire | `LabourAssignmentFactory.cs:120-140` — `"contract_piece"`/`"contract"` → `Contract`; anything unrecognised → `Hired` |
| Both wire keys are read | `LedgerDerivationService.cs:330` — `MapLabourEngagement(ReadString(item,"engagementType"), ReadString(item,"type"))` |
| **The prompt teaches exactly one contract shape, and it is measured** | `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/Prompts/buckets/labour.v1.md:8` — `"Contract ne 2 acre chhatani keli" => labour type CONTRACT, contractQuantity 2, contractUnit Acre` |
| Nothing teaches a spoken fixed price | No occurrence of `lump`, `ठरल`, `उक्त` or `ठेका` anywhere in `labour.v1.md` (whole file, 27 lines) |
| **The golden set contains ZERO contract cases** | `src/clients/mobile-web/tests/ai-golden-set/dataset.json` — no `contract`, `उक्त`, `ठेका`, `ठरल` or `lump` anywhere in the file; its one labour case, `gold_002`, is an English day-rate line (`"Paid 1500 rupees to 5 women for weeding."`) |

**CORRECTION to `closure-economic-report.md` §7.2.** The report says the prompt "has no lump-sum
instruction at all" — correct. It does not say the harder thing: there is **no measurement
either**. The golden set has no contract case of any kind, in any language, so "whether the model
reliably emits CONTRACT" is not a question the current suite can answer, before or after a prompt
change. That is why this entry is about running cases first, not about editing the prompt first.

### Why it is NOT in R1

Two reasons, both hard:

1. **R1 touched no prompt.** Touching one means a prompt-version bump plus a golden-set delta
   (`CLAUDE.md` → Definition of Done), which is a different gate from this release's.
2. **You cannot fix what you have not measured.** Editing the prompt on a hunch, with no
   contract case in the golden set, would produce an unfalsifiable claim of improvement.

### What "done" looks like

**Before farmer release**, in this order:

1. **Measure.** Run representative Marathi/Marathi-English cases through the live parse path —
   at minimum: a whole-job fixed price with no unit (`"हे काम शंकरला 15 हजारात उक्ते दिलं"`), a
   whole-job price with a named crew, and a day-rate control that must NOT come back as
   `Contract`. Record what `engagementType` / `type` actually came back, verbatim.
2. **If it already emits `Contract` reliably: pin it.** Add those cases to
   `src/clients/mobile-web/tests/ai-golden-set/dataset.json` so a later prompt edit cannot
   silently regress them. No prompt change, no version bump.
3. **If it does not: fix it through the normal process, never by hand-editing in place.** The
   prompt version is derived, not typed — `AiPromptTemplateRegistry` picks the
   highest-numbered bucket file (`PickHighestBucketVersion`, `:179-199`, wired at `:56`) and the
   version string carries a content hash (`BuildVersionString`, `:142-149`). So the change is a
   **new `buckets/labour.v2.md`**, which bumps the version automatically, plus the golden-set
   delta and the `_COFOUNDER/memory/prompt-registry.md` entry.
4. Either way the result is written down as a number, not an impression.

### Owner

A **prompt-version + golden-set session** (the `bump-prompt` skill's lane). It must not be folded
into a labour read-side task; the gate is different.

---

## E3 — `LabourEngagementType.Self`: a FOUNDER DECISION, not a bug to guess at

### What it is

`Self` — own or family labour — has no home of its own in a binary रोजंदारी/उक्ते model. Today
it falls to the **रोजंदारी side by default**, because `IsUkte` is false for it.

### Evidence (verified on this branch)

| Fact | File:line |
|---|---|
| The enum has three members; the money model has two buckets | `src/apps/ShramSafal/ShramSafal.Domain/Farms/LabourEngagementType.cs` — `Hired \| Contract \| Self` |
| `Self` is not उक्ते | `GetLabourDataHandler.cs:844-846` — `IsUkte` is true only for `Contract` or a non-null `ContractUnit` |
| So it lands on the रोजंदारी side of all four home figures | `GetLabourDataHandler.cs:877-881` |
| `Self` is reachable from voice | `LabourAssignmentFactory.cs:129` — `"self"` or `"exchange"` → `Self` |
| `Self` is reachable by hand, on a live screen | `src/clients/mobile-web/src/features/logs/components/activity-card/sheets/DetailSheet.tsx:210-221` — the `Daily Wage / Contract / Self` tab row |

**CORRECTION to `closure-economic-report.md` §7.3, and to the framing of this item as
"if money exists".** The report says a `Self` engagement *carrying a stated `TotalCost`* lands on
the रोजंदारी money card. True — `SumStated` filters to `TotalCost is not null`
(`GetLabourDataHandler.cs:853-862`), so with no money stated the money card is untouched. But the
money card is not the only surface:

- **The HEADCOUNT lands on रोजंदारी regardless of money.** `SumKnownHeadcounts`
  (`:864-872`) filters on a resolvable headcount, not on cost, and `RojandariToday` /
  `OnFarmToday` (`:879-881`) count the row whether or not anyone was paid. So family work
  already inflates *"आज कामावर — रोजंदारी"* today, with no money involved at all.

A second thing surfaced while verifying this, and it belongs to the same decision:

- **The `Self` panel already tells the farmer money will not be recorded — and nothing enforces
  it.** `DetailSheet.tsx:387` reads *"No cost will be recorded for this activity."* Switching to
  the `SELF` tab does `setLocalData({ ...localData, type: t })` (`:216`) — it **preserves**
  `totalCost`. The auto-calculation is skipped for `SELF` (`:116` guards on
  `localData.type === 'HIRED'`), but a cost typed or auto-derived while the tab was `HIRED`
  survives the switch. So a `Self` row can carry money **on a screen that just promised it would
  not** — which makes this a copy-honesty question as well as an economics one.

### Why it is NOT in R1

Because there is nothing to implement until the founder rules. The two candidate meanings are
incompatible and **neither can be inferred from the code**:

- **(a) Exclude.** Own/family work is not paid work: it leaves the paid-work money cards *and*
  the paid-work headcount, and the app never shows a rupee against it. Then `DetailSheet.tsx:387`
  becomes true and must be enforced, not merely printed.
- **(b) Record.** ShramSafal may record an **explicitly stated** imputed labour cost for own
  work — the farmer's own words, never a number the app derives — and then it needs its own
  place to be shown, because putting it on the रोजंदारी card states that someone is owed money
  who is not.

**Invent no semantics.** Do not add a third bucket, a third card, a `SELF` filter, or an
"imputed" flag on the strength of this document. Nothing about `Self` may be implemented until
the founder answers.

### The question to put to him (copy-paste)

> स्वतःचं / घरचं काम (`Self`) — ते "मजुरी" मध्ये मोजायचं का नाही?
>
> 1. **वगळायचं** — घरच्या कामाचा पैसा आणि माणसं मजुरीच्या आकड्यात कधीच येणार नाहीत.
> 2. **नोंदवायचं** — तुम्ही स्वतः सांगितलेला खर्च नोंदवता येईल, पण तो वेगळा दिसेल, रोजंदारीत मिसळणार नाही.
>
> (आजची स्थिती: घरची माणसं "आज कामावर — रोजंदारी" मध्ये मोजली जातात, आणि खर्च सांगितला असेल तर तो
> रोजंदारीच्या पैशात मिसळतो — स्क्रीन मात्र "no cost will be recorded" असं म्हणते.)

### Owner

**The founder — decision only.** Then the naming / Contract-V1 session carries whatever he rules
into a plan. No code session owns this yet, and none should start one.

---

## M1 — the manual attendance door (three unfinished controls)

### What it is

Three controls on the manual हजेरी capture screen promise things the app does not do: a save
button that says *"जतन करा → मंजुरीसाठी"* with no approval behind it, a headcount the save
discards, and a *"नाव जोडा"* that only shows a toast.

### Evidence

**Do not restate it here.** The whole hand-off — what each control promises, what actually
happens, the flag that holds the door shut, the test that pins it closed, and what "finished"
would have to mean — already lives in:

> **`docs/superpowers/plans/precision/followup-manual-attendance-door.md`**

Its own contents index: §1 the door and the pin · §2 Item 1 (the approval that does not exist) ·
§3 Item 2 (the discarded counter) · §4 Item 3 (the toast) · §5 constraints binding on whoever
picks it up · §6 done means.

The one line worth carrying at this level, because it is the release-relevant fact: the door is
**provably unreachable by a farmer** (`SHOW_ATTENDANCE_TILE = false`, pinned by
`LabourFeature.attendanceDoorClosed.test.tsx`), which is why three unfinished controls are not a
merge blocker.

### Why it is NOT in R1

Nothing is broken for a farmer — the screen cannot be reached. Per **Decision 4b (2026-07-19,
screen honesty)**, un-hiding means *finishing*, all three items, not one or two. That is a
feature-sized piece of work, not a release fix.

### What "done" looks like

Exactly what §6 of that document says. This register does not add to it or reinterpret it.

### Owner

**Whoever opens the door owns all three** — the same rule that document states. Unassigned today.
The pin test is the thing that will stop an accidental partial opening.

---

## T1 — the trust surface: no score or auto-approval claim reaches a farmer unless the mechanism is real

### What it is

Reliability/reputation copy is **already live on named humans**, and two live strings assert
mechanisms that do not exist:

1. **A score computed from zero metrics.** Every worker's reliability is `100.00`, because the
   metrics source returns zeros and the formula's zero-case defaults every ratio to 1.
2. **A promise of auto-approval that nothing implements.** The review sheet tells the farmer that
   entries from someone he has "given trust" to skip the queue and are approved automatically.

### Evidence (verified on this branch, end to end)

**The score:**

| Step | File:line |
|---|---|
| The metrics source is a stub returning zeros | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Repositories/ShramSafalRepository.cs:1404-1419` — `return Task.FromResult(new WorkerMetricsDto(0, 0, 0, 0, 0, 0, 0));` with its own comment: *"ReliabilityScore is not a real number today. Do not let it become a portable reputation until it is."* |
| Those zeros are fed straight into the formula | `src/apps/ShramSafal/ShramSafal.Application/UseCases/Work/GetWorkerProfile/GetWorkerProfileHandler.cs:81-91` |
| The formula's zero-case makes every ratio 1 | `src/apps/ShramSafal/ShramSafal.Domain/Work/ReliabilityScore.cs:28-30` — `logCount30d == 0 ? 1m : …`, `plannedCount == 0 ? 1m : …` |
| So `Overall` = 0.50×100 + 0.30×100 + 0.20×100 = **100.00 for everyone** | `ReliabilityScore.cs:32-34` |
| And it is rendered, in Marathi, on a named human | `src/clients/mobile-web/src/features/work/components/ReliabilityScoreCard.tsx:106` (`विश्वासार्हता गुण`), `:112` (`Reliability Score · 30-day window`) |
| Reached from the farmer's own profile | `src/clients/mobile-web/src/features/profile/sections/IdentitySection.tsx:406-415` — `Your reliability`, gated only on `isWorkerOnAnyFarm && workerProfile` |

**The auto-approval promise:**

| Step | File:line |
|---|---|
| The live string | `src/clients/mobile-web/src/features/labour/components/ReviewSheet.tsx:639` — `why="… ज्याच्यावर विश्वास दिला, त्याच्या नोंदी इथे येत नाहीत — आपोआप मंजूर."` |
| The sheet is live, not flag-gated | `src/clients/mobile-web/src/features/labour/components/LabourFeature.tsx:387` |
| The server hardcodes every worker to review | `GetLabourDataHandler.cs:407` — `Access: "review", // trust-graduation not yet built — every worker defaults to owner-review.` |
| The UI that would grant trust is hidden | `src/clients/mobile-web/src/features/labour/components/PersonDetail.tsx:43` — `const SHOW_TRUST_GRADUATION = false;` |
| …and would not reach the server anyway | `PersonDetail.tsx:55` — granting is local `useState` only |
| **The identical claim was already deleted from the hub in this release** | `LabourHub.tsx:446-456` — Task 22 removed *"· विश्वासू कामगाराच्या नोंदी आपोआप मंजूर करा"* for exactly this reason. `ReviewSheet.tsx:639` is the **same claim, in a second place, still live.** |

That last row is the sharpest fact in this entry: the project has already ruled on this sentence
once. The ruling did not reach every copy of it.

### Why it is NOT in R1

It is **not Labour V2 scope**. The reliability score belongs to the Work/CEI surface
(`features/work`, `features/profile`), not the labour feature; the review-sheet string sits
inside labour but asserts a Work-side mechanism. R1's vocabulary work deliberately did not widen
into that surface — the same boundary `farmerVocabulary.scan.test.ts` draws, and the same reason
N11 exists as a *named* gap rather than a fixed one.

It is a **named PRE-PILOT follow-up**: it must be settled before real farmers and real workers
see these screens, and it does not have to be settled to merge R1.

### The rule to record (this is the durable part)

> **No trust score, reliability score, or auto-approval claim reaches a farmer unless the
> underlying mechanism is real.**
>
> A number computed from no data is not a low-confidence number — it is a fabricated one, and
> `AGRISYNC-DOCTRINE.md`'s no-fabricated-numbers rule covers it. A sentence describing behaviour
> the app does not have is not aspirational copy — it is a false statement to the person whose
> reputation it describes.

### What "done" looks like

Any of these is an acceptable resolution; guessing between them is not:

- The surfaces are hidden until their mechanisms exist (the `SHOW_TRUST_GRADUATION` treatment,
  applied consistently), **or**
- The mechanisms are built — a real metrics read-model behind
  `GetWorkerMetricsAsync`, a real trust-graduation write path behind `Access` — and the copy then
  becomes true, **or**
- The copy is rewritten to state only what is true today, and the score is not shown as a score.

Plus, in every case: **one sweep, not one file.** The Task 22 deletion is proof that fixing one
occurrence leaves the others. The sweep must cover at minimum `ReviewSheet.tsx`,
`ReliabilityScoreCard.tsx`, `IdentitySection.tsx`, `PersonDetail.tsx` and `WorkerProfilePage.tsx`,
and should consider widening `farmerVocabulary.scan.test.ts`'s scope so a re-introduction fails a
test rather than an audit.

### Owner

A **pre-pilot trust-surface session**, owning the Work/CEI surface and the labour string
together. It needs a founder ruling on *which* of the three resolutions applies before it starts;
the doctrine rule above binds it whichever he picks.

---

## Accepted risks — recorded, not hidden

These two are **not** follow-up projects and **not** hidden failures. They were reasoned about,
bounded, and accepted during R1. They are written here so that a later reader finds them named
rather than discovering them.

### R-A — the acknowledged-before-pull window

**The shape.** The register reads attendance from two local halves and labels each:
`db.attendanceMarks` (server-acknowledged, `source: 'server'`) and the live mutation queue
(`source: 'queue'`). `APPLIED` is deliberately excluded from the queue half — once the server has
acknowledged, the server row owns the fact
(`src/clients/mobile-web/src/features/labour/data/attendanceLocal.ts:44`, `:51-56`, `:58-63`).

But the two events are separate: `markApplied` fires the moment the push result comes back
(`src/clients/mobile-web/src/infrastructure/sync/BackgroundSyncWorker.ts:376-378`), while the
server row only lands when the pull's reconciler writes it
(`src/clients/mobile-web/src/features/sync/pull/reconcilers/attendanceReconciler.ts:26-28`).
**Between those two moments a mark is in neither half** and does not render.

**Why it is accepted.** The window is normally one network round-trip inside a single sync cycle:
`executeCycle` runs `pushPendingMutations()` then `pullLatestDeltas()` back to back
(`BackgroundSyncWorker.ts:293-294`). The alternative — keeping `APPLIED` rows in the queue half —
would show the same fact twice, or show acknowledged truth wearing the unsynced treatment, which
P10 forbids in the other direction. No fact is lost: it is on the server, and the next successful
pull renders it.

**What would make it stop being acceptable.** If the pull fails or the app is closed in between,
the window lasts until the next successful pull — which a farmer could see as a mark that
briefly vanished. If field use shows that, the fix is to make the two writes one transition, not
to relax the queue filter.

### R-B — the cross-device identical-disturbance duplicate

**The shape.** Disturbance derivation is now once-per-(farm, log-day, reason) via
lookup-before-write, which closes the ruled defect: the same *"पाऊस आला"* arriving through both
the हजेरी door and the regular door on one farm-day used to land twice. Same-device duplicates
are closed **deterministically** (single-flight sync worker, sequential batch application inside
one transaction).

**The residual.** The lookup is **application-level**. Two overlapping READ-COMMITTED pushes from
**different devices**, carrying the same farm, same day and byte-identical reason, can both miss
the lookup and both commit. This is the pre-fix status quo — no worse than before, just no longer
the common case.

**Why it is accepted (per the controller ruling, `reports/task-4.85-report.md` §"Enforcement
boundary"):** it is an edge window; it is downstream-idempotent for `DeclaredNoWork`; and the
schema cure — denormalising the parent's farm and day onto the child so a unique index can be
declared — is itself a two-truths shape this release forbids.

**It has a named observer, not silence.** The production lookup materialises the identity's live
matches and `LogWarning`s when there is more than one — farm, day, count, and the reason's
**LENGTH only**, never the farmer's free text. Pinned by `DisturbanceDedupObserverTests` (the
warning fires, the oldest row is returned, the reason text is never reproduced, and the
single-row case cries no wolf).

**DB hardening is deferred, with a trigger.** A DB-enforced unique constraint is the **Phase 6**
hardening, to be taken up **if field data shows that warning firing** — recorded in
`docs/superpowers/plans/precision/phase-4-register.md`, deployment section. Nobody should build it
before the observer says it is needed.

---

## Standing rules this register operates under

1. **Nothing here is approved to be implemented.** E3 and M1 are blocked on a founder decision;
   E1, E2 and T1 name a shape, not a mandate.
2. **Unmeasured is said as unmeasured.** E2's parser behaviour and E1's client-boundary
   consequence are both unmeasured, and neither may be described as working or broken.
3. **Internal names stay internal.** Nothing in this file proposes renaming a domain type. Where
   an internal name has already escaped to a farmer's screen, the vocabulary audit's E-bis table
   is the record, not this file.
4. **The residuals are risks, not tasks.** R-A and R-B must not be turned into work items by a
   later reader; each names the condition under which that would change.

---

*End of register. Evidence and judgement only; nothing was changed, fixed, renamed or removed.*
