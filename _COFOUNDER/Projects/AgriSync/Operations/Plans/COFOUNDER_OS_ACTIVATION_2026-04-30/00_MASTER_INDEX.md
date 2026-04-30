# 00 — MASTER INDEX

**Campaign:** COFOUNDER_OS_ACTIVATION
**Date opened:** 2026-04-30
**Owner:** Founder (Aakash) + Cofounder OS (this campaign builds it)
**Status:** PLAN APPROVED — execution gated on founder sign-off of open questions in §9
**Target outcome:** Repo health 46 → 92+, fully agentic engineering team, MVP-ready harness

---

## 1. Mission

Activate **Cofounder Mode** for AgriSync: a Claude-Code-native operating system that turns a solo founder into a fully-staffed engineering org by orchestrating a roster of specialized AI agents under deterministic gates, with persistent memory and a closed feedback loop that learns from its own mistakes.

This campaign is the *bootstrap* for that OS. Once shipped, every future feature on AgriSync flows through this harness.

---

## 2. North-star outcomes (definition of victory)

- **Repo health ≥ 92/100** on the rubric in `07_DEFINITION_OF_DONE_AND_SCORECARD.md`
- **Slop rate < 15%** (rework iterations / merged PRs) over a rolling 7-day window
- **Auto-merge rate ≥ 40%** (PRs merged with zero human edits) by end of Week 4
- **First-push CI pass rate ≥ 80%** for agent-authored PRs by end of Week 4
- **At least 3 specs** moved through the full pipeline (`_inbox → _active → _shipped`) using the cofounder OS itself
- **At least 1 prompt-version bump** driven by the auto-curator loop (proves Ring 4 closed)
- **Zero secrets in git, zero `dist/` artifacts in git, zero `Class1.cs` placeholders** (proves repo hygiene)

---

## 3. Operating model

| Concern | Owned by | Lives at |
|---|---|---|
| Strategy / product / roadmap | `coordinator` agent | `/_COFOUNDER/roadmap/`, `/_COFOUNDER/specs/` |
| Architecture / ADRs / fitness | `architect` agent | `/_COFOUNDER/adr/` |
| Build (backend / frontend / AI) | `implementor-*` agents | `src/**` per allowlist |
| Independent test authoring | `test-writer` agent | `tests/**`, `src/clients/mobile-web/tests/**` |
| Independent review / block | `verifier` agent | review verdicts only — **never writes code** |
| CI / CD / secrets / deploy | `ops-engineer` agent | `.github/workflows/`, `Makefile`, devcontainer |
| Memory upkeep | `doc-curator` agent | `/_COFOUNDER/memory/`, `/_COFOUNDER/adr/INDEX.md` |
| Slop reduction loop | `slop-auditor` agent | `/_COFOUNDER/dashboards/`, planner context |

The **harness** — not the model — is the source of reliability. Each agent has a small allowed file set, a fresh context window, and a mandatory pre/post-tool-use gate.

---

## 4. The four rings (architecture summary)

| Ring | Concern | Primary plan file |
|---|---|---|
| **Ring 1** | **Spec layer** — what before code | `01_FOLDER_LAYOUT_AND_CHARTER_PLAN.md` |
| **Ring 2** | **Agent topology** — Coordinator → Implementor(s) → Verifier | `02_AGENT_ROSTER_AND_TOPOLOGY_PLAN.md` |
| **Ring 3** | **Deterministic gates** — hooks, CI, branch protection | `03_HOOKS_AND_DETERMINISTIC_GATES_PLAN.md`, `04_CI_CD_AND_SECURITY_HARDENING_PLAN.md` |
| **Ring 4** | **Memory & feedback** — corrections corpus, prompt registry, slop dashboard | `05_MEMORY_FEEDBACK_AND_SLOP_LOOP_PLAN.md` |
| Cross-cut | Operations runbooks, devcontainer, telemetry | `06_OPS_RING_AND_RUNBOOKS_PLAN.md` |
| Cross-cut | Acceptance, scorecard, scoring rubric | `07_DEFINITION_OF_DONE_AND_SCORECARD.md` |

---

## 5. Plan file index

| # | File | Owner | Pages | Phases covered |
|---|---|---|---|---|
| 00 | `00_MASTER_INDEX.md` | Founder | this | All |
| 01 | `01_FOLDER_LAYOUT_AND_CHARTER_PLAN.md` | architect | ~ | Phase 1 (Foundation) |
| 02 | `02_AGENT_ROSTER_AND_TOPOLOGY_PLAN.md` | architect + coordinator | ~ | Phase 2 (Topology) |
| 03 | `03_HOOKS_AND_DETERMINISTIC_GATES_PLAN.md` | ops-engineer | ~ | Phase 3 (Gates) |
| 04 | `04_CI_CD_AND_SECURITY_HARDENING_PLAN.md` | ops-engineer | ~ | Phase 1 + 3 |
| 05 | `05_MEMORY_FEEDBACK_AND_SLOP_LOOP_PLAN.md` | doc-curator + slop-auditor | ~ | Phase 1 + 4 |
| 06 | `06_OPS_RING_AND_RUNBOOKS_PLAN.md` | ops-engineer | ~ | Phase 4 |
| 07 | `07_DEFINITION_OF_DONE_AND_SCORECARD.md` | architect | ~ | All |

If any single file exceeds 1500 lines during execution, it is split into:

```
plans/<NN_NAME>/
  PART1.md
  PART2.md
  ...
```

Cross-links between split parts are mandatory (top of file links to siblings).

---

## 6. Phase timeline

```
Week 1 ── PHASE 1 ── Foundation & Memory (Rings 1+4 seed)
          └─ Plans 01, 04, 05 (partial)
Week 2 ── PHASE 2 ── Agent Topology (Ring 2)
          └─ Plan 02
Week 3 ── PHASE 3 ── Deterministic Gates (Ring 3)
          └─ Plans 03, 04 (full)
Week 4 ── PHASE 4 ── Loop Closure & Ops Ring
          └─ Plans 05 (full), 06, 07
```

Each phase ends with a **gate review** (founder sign-off + scorecard re-run) before the next phase begins. A failed gate review halts the campaign and triggers a corrections-corpus entry.

---

## 7. Phase summaries

### Phase 1 — Foundation & Memory (Week 1)
Lay the bones: migrate legacy folder, write CHARTER + root CLAUDE.md, seed ADR repo with decisions already made, seed memory skeletons, scrub repo (secrets, dist, placeholders), get a green baseline CI.

### Phase 2 — Agent Topology (Week 2)
Author all 10 agent definitions, wire skills (`/plan-spec`, `/review-pr`, `/new-adr`, etc.), establish path allowlists, run a real spec end-to-end through the pipeline, capture every rough edge in `corrections.md`.

### Phase 3 — Deterministic Gates (Week 3)
Implement hook scripts, branch protection, full CI matrix (arch tests, AI eval, security, mutation, slop budget). Test refusal paths — i.e., try to push a "bad" PR and verify every gate fires.

### Phase 4 — Loop Closure & Ops Ring (Week 4)
Persist `CorrectionEvent`s server-side, run nightly Slop-Auditor, ship the prompt-curator job, write runbooks, devcontainer, Makefile, hallucination guardrail (CoVe) on `GeminiClient`, agent telemetry, and finally — write the spec for the cofounder OS itself, retroactively, and walk it through Verifier as the final acceptance test.

---

## 8. Cross-references

### Legacy plans (preserved verbatim)
- `_COFOUNDER/legacy/Projects/AgriSync/Operations/Plans/INDUSTRY_GRADE_HARDENING_2026-04-27/`
  - `00_MASTER_INDEX.md` — original master index
  - `03_BACKEND_ARCHITECTURAL_DEPTH_PLAN.md` — backend depth
  - *(other files to be migrated)*

### Predecessors & supersession
- This campaign **does not supersede** `INDUSTRY_GRADE_HARDENING_2026-04-27`. It **wraps** it: the hardening plan continues to drive the *what*, the cofounder OS drives the *how*.
- Items from the hardening plan that fit one of the four rings are migrated into specs/ADRs; items that don't are linked from `roadmap/LATER.md`.

### Related artifacts
- Charter: `/_COFOUNDER/CHARTER.md` (created in Phase 1.3)
- Operating manual: `/_COFOUNDER/CLAUDE.md` (created in Phase 1.4)
- Root entry point: `/CLAUDE.md` (created in Phase 1.4)
- Agent roster: `/_COFOUNDER/agents/AGENTS.md` (created in Phase 2.1)

---

## 9. Open questions blocking execution

These must be answered before Phase 1 begins. Founder responses go inline below each question.

1. **Legacy folder transfer.** The Windows `_COFOUNDER` folder at `E:\APPS\Running App Versions\AgriSyncPlatform\_COFOUNDER\` is not visible from the build environment. Required action: copy or zip the folder into the repo at `/_COFOUNDER/legacy/` (or paste contents). Until done, Phase 1.1 is blocked.
   > **Founder answer:**

2. **North-star metric for `CHARTER.md`.** Recommendation: *"Daily logs successfully parsed without manual review per active farmer per week."* Alternatives: parse-success rate, AI-eval golden-set score, farmer DAU.
   > **Founder answer:**

3. **First pilot spec for Phase 2 dry run.** Recommendation: *"Persist `CorrectionEvent`s server-side via a new `/api/corrections` endpoint in ShramSafal."* Small, real, exercises backend + AI implementors + Verifier.
   > **Founder answer:**

4. **Slop-rate thresholds.** Recommendation: 25% start of Week 2, 15% by end of Week 4. Tighten quarterly thereafter.
   > **Founder answer:**

5. **Agent roster sign-off.** 10 agents listed in §3. Add, remove, or rename?
   > **Founder answer:**

6. **Branch protection & signed commits.** Solo-founder mode still enforces "no merge on red CI" and signed commits. Confirm acceptance.
   > **Founder answer:**

7. **Devcontainer baseline.** Recommendation: Ubuntu 22.04 + .NET 9 SDK + Node 20 LTS + dotnet-format + ESLint + Prettier. Alternatives: dev tools you already use.
   > **Founder answer:**

---

## 10. Definition of done (campaign-level)

The campaign is **DONE** when ALL of the following are true:

- [ ] Every plan file in this folder marked `STATUS: SHIPPED`
- [ ] All open questions in §9 answered
- [ ] Scorecard in `07_DEFINITION_OF_DONE_AND_SCORECARD.md` ≥ 92/100
- [ ] Three specs present in `/_COFOUNDER/specs/_shipped/`
- [ ] At least 7 days of slop-rate telemetry under threshold
- [ ] At least one prompt-version bump driven by Slop-Auditor in `/_COFOUNDER/memory/prompt-registry.md`
- [ ] Founder gate-review note appended at the bottom of this file

---

## 11. Risks (campaign-level)

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Solo + no human review = silent regressions | High | Verifier in fresh context; weekly `/audit-slop`; CI redundant gates | architect |
| Cofounder OS becomes its own slop generator | Med | OS gets its own NOW.md; capped scope per phase | coordinator |
| Prompt drift on model upgrades | Med | Versioned prompts + golden-set gate | implementor-ai |
| Worktree conflicts across implementors | Med | Coordinator emits serial DAG when contexts overlap | coordinator |
| Memory bloat | Low | Monthly compression to top-of-file summary | doc-curator |
| Tool surface too wide for solo to maintain | Med | Every script has a runbook; orphan scripts auto-deleted | ops-engineer |
| Scope creep into "nice-to-have" guardrails | High | Hard line: only items in this index ship in this campaign | founder |

---

## 12. Gate-review log

| Phase | Date | Status | Notes | Signed |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| Campaign close | | | | |

---

## 13. How to read this campaign

1. Start here (`00_MASTER_INDEX.md`).
2. Answer §9 open questions.
3. Read `01` → `07` in order; each plan file is self-contained but assumes prior files for context.
4. Each plan file has the same shape: **Goal → Phases → Sub-phases → Tasks → Acceptance → Risks**.
5. Tasks are numbered `<plan>.<phase>.<sub>.<task>` (e.g., `01.1.2.3` = plan 01, phase 1, sub-phase 2, task 3).
6. When a task is shipped, mark it `[x]` and append a note with date + commit SHA.

---

## 14. Cofounder oath (the principles that bind every agent)

1. **No spec, no PR.** Code without a written spec is technical debt by birth.
2. **The harness is law.** If a gate is failing, fix the underlying issue; never `--no-verify`.
3. **One agent, one job.** Cross-cutting work is the Coordinator's problem, not the implementor's.
4. **Verifier is independent.** It reads spec + diff. It never sees the implementor's reasoning.
5. **Memory is sacred.** Every rejection becomes a correction. Every correction trains the next plan.
6. **Reversible by default.** Prompt versions, ADR supersession, worktree isolation — undo is always one revert away.
7. **The cofounder eats its own dog food.** Every change to the cofounder OS goes through the cofounder OS.

These oaths appear verbatim at the top of every agent's system prompt.

---

*End of Master Index.*
