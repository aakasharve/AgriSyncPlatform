# 01 — FOLDER LAYOUT & CHARTER PLAN

**Campaign:** COFOUNDER_OS_ACTIVATION_2026-04-30
**Plan owner:** `architect` agent
**Status:** READY (blocked on §9.1 of master index)
**Phases covered:** Phase 1 (Foundation) — primary; Phases 2–4 — minor touch-ups

---

## Goal

Lay the bones of the Cofounder OS: migrate any pre-existing `_COFOUNDER` content untouched, establish the canonical folder layout under `/_COFOUNDER`, write the **CHARTER** (mission, principles, north-star), and write the two **CLAUDE.md** files (root + `_COFOUNDER`) that every agent reads on session start.

Once this plan is shipped, every other plan in this campaign has a place to live and a constitution to obey.

---

## Phase 1 — Foundation (Week 1)

### Sub-phase 1.1 — Migrate legacy folder

**Pre-condition:** Founder has copied or zipped the Windows `_COFOUNDER` folder (`E:\APPS\Running App Versions\AgriSyncPlatform\_COFOUNDER\`) into `/home/user/AgriSyncPlatform/` (or has pasted the contents).

#### Task 01.1.1.1 — Verify legacy contents are present
- Run `ls -la /home/user/AgriSyncPlatform/_COFOUNDER/` and confirm structure matches founder's description.
- If no content present, halt this sub-phase and flag §9.1 of `00_MASTER_INDEX.md`.
- **Acceptance:** non-empty listing; founder confirms files match their Windows view.

#### Task 01.1.1.2 — Move legacy under `/_COFOUNDER/legacy/`
- Create `/_COFOUNDER/legacy/` if it does not exist.
- Move every existing top-level entry under `/_COFOUNDER/` that is NOT one of the canonical names (see Sub-phase 1.2) into `legacy/`, preserving subtree structure.
- Do **not** edit any file inside `legacy/`. It is frozen.
- Add `legacy/README.md` with: "This subtree is the verbatim migration from Windows `_COFOUNDER` as of YYYY-MM-DD. Do not edit. New content goes into siblings."
- **Acceptance:** `git status` shows the moves; legacy files unchanged in content (verify via `git diff --check`).

#### Task 01.1.1.3 — Index legacy plans into the new campaign
- Walk `/_COFOUNDER/legacy/Projects/AgriSync/Operations/Plans/` and list every plan folder + master index found.
- In `00_MASTER_INDEX.md` §8, append one row per legacy campaign with: name, date, status (active/superseded), and a link.
- **Acceptance:** every legacy campaign is referenced from the master index.

---

### Sub-phase 1.2 — Establish `/_COFOUNDER` skeleton

#### Task 01.1.2.1 — Create canonical top-level folders
Create the following directories (empty placeholders are acceptable; populate in later sub-phases):

```
/_COFOUNDER/
├── README.md                    (Task 01.1.2.2)
├── CHARTER.md                   (Sub-phase 1.3)
├── CLAUDE.md                    (Sub-phase 1.4)
├── legacy/                      (already populated in 1.1)
├── roadmap/
│   ├── NOW.md
│   ├── NEXT.md
│   ├── LATER.md
│   └── HORIZONS.md
├── specs/
│   ├── _template/
│   │   ├── spec.md
│   │   ├── plan.md
│   │   └── tasks.md
│   ├── _inbox/.gitkeep
│   ├── _active/.gitkeep
│   ├── _shipped/.gitkeep
│   └── _killed/.gitkeep
├── adr/
│   ├── INDEX.md
│   └── (0001 … 000N populated in Sub-phase 1.5)
├── runbooks/.gitkeep
├── dashboards/.gitkeep
├── memory/
│   ├── corrections.md
│   ├── glossary.md
│   ├── prompt-registry.md
│   └── decisions-log.md
├── scripts/.gitkeep
└── Projects/                    (campaigns live here, including this one)
```

- **Acceptance:** `tree /_COFOUNDER -L 2` matches above; all `.gitkeep` files committed.

#### Task 01.1.2.2 — Author `/_COFOUNDER/README.md`
Sections to include (in this order):
1. **What is this folder.** One paragraph: "the Cofounder OS for AgriSync."
2. **How to read it.** Order: README → CHARTER → CLAUDE.md → roadmap/NOW.md → adr/INDEX.md → specs/_active.
3. **Canonical structure.** Tree above + 1-line description per entry.
4. **Who owns what.** Table mapping each subfolder to an agent owner.
5. **How to contribute.** Always via a spec; never edit `legacy/`.
6. **Versioning rule.** This folder is plain markdown by design. No build step. No code.
- **Acceptance:** README links to CHARTER, CLAUDE.md, AGENTS.md, the master index of this campaign.

---

### Sub-phase 1.3 — Author `CHARTER.md`

The charter is the unchanging spine. It is read by every agent on every session.

#### Task 01.1.3.1 — Mission (1 paragraph)
- One paragraph, ≤ 80 words.
- Recommended draft (founder approves or edits): *"AgriSync is a voice-first farm operations platform that gives smallholder farmers an honest, auditable record of every action on their farm — labour, inputs, irrigation, harvest, finance — captured in their language, structured by AI, owned by them."*
- **Acceptance:** Founder signs off.

#### Task 01.1.3.2 — Principles (5 short)
- Five principles, each one sentence. Recommended seed:
  1. **Founder time is the scarcest resource.** Optimize the system for it.
  2. **Specs before code, always.**
  3. **The harness, not the model, is the source of reliability.**
  4. **Reversible by default.**
  5. **The cofounder eats its own dog food.**
- **Acceptance:** Founder signs off; principles ≤ 20 words each.

#### Task 01.1.3.3 — North-star metric
- ONE metric. Recommended: *"Daily logs successfully parsed without manual review per active farmer per week."*
- Define: numerator, denominator, source of truth, refresh cadence.
- **Acceptance:** Metric is countable, sourced, has a baseline (collect from current data) and a 6-month target.

#### Task 01.1.3.4 — Cofounder oath (verbatim from master index §14)
- Copy the 7 oaths from `00_MASTER_INDEX.md` §14 verbatim.
- These oaths are referenced by every agent's system prompt; **changing the oath requires an ADR**.
- **Acceptance:** Oaths copied verbatim; cross-link to master index.

#### Task 01.1.3.5 — Non-goals
- 3–5 things AgriSync explicitly is NOT (e.g., "not a marketplace," "not a fintech ledger," "not a generic farm-management SaaS").
- **Acceptance:** Each non-goal is justified in one line.

---

### Sub-phase 1.4 — Author `CLAUDE.md` files (root + cofounder)

These are the operating manuals that every Claude Code session loads automatically.

#### Task 01.1.4.1 — Root `/CLAUDE.md`
Sections:
1. **Project name & one-line summary.**
2. **Stack inventory.** .NET 9 backend (Domain/Application/Infrastructure/Api per app), Vite + React 19 + TS frontend, Gemini 2.0 Flash for AI, Dexie for offline storage, Zod for schemas.
3. **Layering rules (hard).**
   - Domain may not import Infrastructure or Api.
   - SharedKernel is the only cross-app surface.
   - Frontend `domain/` may not import `infrastructure/` or `pages/`.
4. **Cofounder OS pointer.** "All decisions, plans, ADRs, and memory live under `/_COFOUNDER/`. Read `/_COFOUNDER/CLAUDE.md` next."
5. **Hard rules.** No secrets in git. No `dist/` in git. No `--no-verify`. No force-push to main. Signed commits required.
6. **Commit & PR conventions.** Conventional Commits, link spec ID in body, never amend after push.
7. **Definition of done for any change.** Spec referenced; tests added; arch tests pass; if AI prompt touched → version bumped + golden-set delta.
- **Length cap:** 200 lines.
- **Acceptance:** Verifier agent can answer "what are the layering rules?" using only this file.

#### Task 01.1.4.2 — `/_COFOUNDER/CLAUDE.md`
Sections:
1. **Charter pointer.** Read `CHARTER.md` first.
2. **Operating loop.** Coordinator → Implementor(s) → Test-Writer → Verifier → Doc-Curator → Slop-Auditor.
3. **Spec lifecycle.** `_inbox → _active → _shipped` (or `_killed`). Template at `specs/_template/`.
4. **ADR lifecycle.** Proposed → Accepted → (Superseded by NNNN). Never delete; never edit accepted.
5. **Memory rules.** Append-only. Monthly compression by Doc-Curator.
6. **Agent rules.** Each agent reads its own `.md` definition + this file + CHARTER on every session start.
7. **Founder escalation.** When to surface to the founder vs. proceed (see Decision Authority Matrix below).
- **Length cap:** 250 lines.
- **Acceptance:** A new agent (or a fresh Claude Code session) can produce a valid first PR using only CHARTER + this file + their agent definition.

#### Task 01.1.4.3 — Decision Authority Matrix
Add to `/_COFOUNDER/CLAUDE.md` as an embedded table:

| Action | Coordinator | Architect | Implementor | Verifier | Founder |
|---|---|---|---|---|---|
| Accept new spec into `_active` | ✅ | review | — | — | sign-off |
| Modify CHARTER | propose | propose | — | — | ✅ only |
| Add new ADR | review | ✅ | — | review | sign-off if hard rule |
| Supersede ADR | review | propose | — | — | ✅ |
| Approve PR to merge | — | — | — | ✅ verdict | gate-review monthly |
| Bump prompt version | — | — | implementor-ai | review | — |
| Modify gates / hooks | — | — | ops-engineer | review | sign-off |
| Spend budget on tooling | — | — | — | — | ✅ |

- **Acceptance:** matrix unambiguous for every row; no two cells can both be ✅ unless explicitly justified.

---

### Sub-phase 1.5 — Seed ADRs from existing decisions

The architect agent retroactively records 8–10 ADRs for decisions you've already made. These stop the agent team from re-litigating settled questions.

#### Task 01.1.5.1 — Author `adr/INDEX.md`
- Columns: Number, Title, Status (Proposed / Accepted / Superseded), Date, Supersedes, Tags.
- Seed with rows pointing to ADRs 0001–00NN created below.
- **Acceptance:** every ADR file has a row in the index.

#### Task 01.1.5.2 — ADR 0001: DDD bounded contexts
- Decision: AgriSync is split into bounded contexts (`User`, `ShramSafal`, plus future), each with its own `Domain/Application/Infrastructure/Api` projects.
- Context: monolith with clear seams beats microservices for solo founder.
- Consequences: cross-context communication via `SharedKernel` events only; no cross-context references.
- **Acceptance:** referenced from layering rules in root CLAUDE.md.

#### Task 01.1.5.3 — ADR 0002: Ports & adapters in mobile-web
- Decision: frontend uses hexagonal architecture (`domain/`, `application/`, `infrastructure/`, `features/`, `pages/`).
- Consequences: domain has zero infra imports; Gemini is an adapter behind `VoiceParserPort`.
- **Acceptance:** referenced by frontend implementor's allowlist.

#### Task 01.1.5.4 — ADR 0003: Outbox pattern for cross-app events
- Decision: cross-context events use the transactional outbox in `BuildingBlocks/Persistence/Outbox`.
- Consequences: no direct service-to-service writes; eventual consistency.

#### Task 01.1.5.5 — ADR 0004: Idempotency keys at API boundary
- Decision: every mutating endpoint accepts an `Idempotency-Key` header, stored in `BuildingBlocks/Idempotency`.
- Consequences: client retries are safe by design.

#### Task 01.1.5.6 — ADR 0005: AI response normalization layer
- Decision: every AI response passes loose-validate → normalize → strict-validate (`AIResponseNormalizer` + Zod).
- Consequences: schema breaks become recoverable; raw model output never touches business logic.

#### Task 01.1.5.7 — ADR 0006: Prompt versioning
- Decision: every system prompt is versioned (`PromptVersion.ts`); changes require a registry update + golden-set delta.
- Consequences: A/B and rollback are first-class operations on prompts.

#### Task 01.1.5.8 — ADR 0007: Vocab learner / corrections corpus
- Decision: vocabulary and few-shot examples are learned from user corrections, not hand-curated.
- Consequences: parser improves with usage; corrections are a product asset.

#### Task 01.1.5.9 — ADR 0008: Confidence policy & manual review
- Decision: low-confidence parses route to manual review; thresholds defined in `ConfidencePolicy`.
- Consequences: the AI never silently writes a low-confidence record.

#### Task 01.1.5.10 — ADR 0009: JWT + role-based scopes
- Decision: auth is JWT with scopes defined in `SharedKernel/ReferenceData/RolesAndScopes`.
- Consequences: API endpoints declare required scope via attribute.

#### Task 01.1.5.11 — ADR 0010: Cofounder OS as the engineering harness
- Decision: this campaign. The cofounder OS is the source of truth for how AgriSync is built.
- Consequences: every future change goes through the harness; no out-of-band edits.
- Cross-link: `00_MASTER_INDEX.md`.

---

### Sub-phase 1.6 — Seed roadmap

#### Task 01.1.6.1 — `roadmap/NOW.md`
- Single-page Markdown.
- Section: "This sprint (Week 1)" with the 6 sub-phases of this plan as bullets, owners, and end dates.
- Section: "Carry-over from legacy" with anything from `legacy/` that fits the next 4 weeks.
- **Acceptance:** founder reads `NOW.md` and knows exactly what's in flight.

#### Task 01.1.6.2 — `roadmap/NEXT.md`
- Sprint after the cofounder OS ships. Likely: backend hardening items from `legacy/INDUSTRY_GRADE_HARDENING_2026-04-27/03_BACKEND_ARCHITECTURAL_DEPTH_PLAN.md`.
- 5–10 items, each with rough size and bounded context.

#### Task 01.1.6.3 — `roadmap/LATER.md`
- Parking lot. Mine from `legacy/` and from this conversation's bonus ideas (BMAD migration, Scion sandbox, Patronus integration, etc.).

#### Task 01.1.6.4 — `roadmap/HORIZONS.md`
- 6–12 month bets. 3–5 items max.

---

### Sub-phase 1.7 — Repo P0 cleanup (cross-cuts hygiene)

#### Task 01.1.7.1 — Scrub `.env*` from history
- Rotate any keys (Gemini, Maps) that were in committed `.env` / `.env.local`.
- Add `.env*` to root `.gitignore` and `src/clients/mobile-web/.gitignore`.
- Use `git filter-repo` (NOT `filter-branch`) to remove `.env`, `.env.local` from all history.
- Force-push to a backup branch first; then to main only after founder approval (this is the one exception in the campaign — log the action in `runbooks/rotate-secrets.md` after the fact).
- Enable GitHub secret scanning + push protection.
- **Acceptance:** `git log -- .env` returns empty; `gitleaks detect --redact` is clean.

#### Task 01.1.7.2 — Remove `dist/` from git
- Add `dist/` to `.gitignore`.
- `git rm -r --cached src/clients/mobile-web/dist/`
- Commit.
- **Acceptance:** `git ls-files | grep '/dist/'` returns empty.

#### Task 01.1.7.3 — Delete `Class1.cs` placeholders
- Locations:
  - `src/apps/ShramSafal/ShramSafal.Application/Class1.cs`
  - `src/apps/ShramSafal/ShramSafal.Domain/Class1.cs`
  - `src/apps/ShramSafal/ShramSafal.Infrastructure/Class1.cs`
  - `src/apps/User/User.Application/Class1.cs`
  - `src/apps/User/User.Domain/Class1.cs`
- Delete all five.
- **Acceptance:** `find src -name 'Class1.cs'` returns empty; `dotnet build` still succeeds.

#### Task 01.1.7.4 — Expand root `README.md`
- Sections: Project pitch (3 lines), how to run locally (link to runbook), how to contribute (link to CLAUDE.md), license, status badge for CI (placeholder until 04 ships).
- **Acceptance:** founder approves; CI badge URL ready (even if 404 until workflows ship).

---

## Phase 2 — Touch-ups (Week 2)

### Sub-phase 1.2.1 — Glossary expansion
- After the agent topology plan (`02_…`) ships, the doc-curator sweeps the codebase and appends every domain term to `memory/glossary.md` with: term, definition, file where defined, status (canonical / deprecated).
- **Acceptance:** ≥ 30 terms.

### Sub-phase 1.2.2 — ADR cross-links from agent prompts
- Each agent definition references the ADRs relevant to its scope.
- Verify by grepping `.claude/agents/*.md` for `ADR-` references.

---

## Phase 3 — Touch-ups (Week 3)

### Sub-phase 1.3.1 — Layering enforcement
- Once architecture tests run in CI (Plan 04), confirm every layering rule from root CLAUDE.md is encoded as a test in `src/tests/AgriSync.ArchitectureTests/`.
- Any rule not encoded is a documentation rule only and must be flagged.

---

## Phase 4 — Touch-ups (Week 4)

### Sub-phase 1.4.1 — Self-spec
- Author `specs/_active/cofounder-os-v1.md` retroactively as the spec for what was built.
- Walk it through the Verifier agent as a smoke test.
- Move to `specs/_shipped/` after sign-off.
- **Acceptance:** the cofounder OS has been built BY itself, end-to-end.

---

## Acceptance criteria (plan-level)

- [ ] `/_COFOUNDER/legacy/` contains the migrated Windows folder, untouched
- [ ] `/_COFOUNDER/` skeleton matches Task 01.1.2.1
- [ ] `CHARTER.md` complete and founder-signed
- [ ] `/CLAUDE.md` and `/_COFOUNDER/CLAUDE.md` complete
- [ ] ≥ 10 ADRs in `adr/` with `INDEX.md`
- [ ] `roadmap/{NOW,NEXT,LATER,HORIZONS}.md` complete
- [ ] No secrets, no `dist/`, no `Class1.cs` in git
- [ ] Root `README.md` expanded
- [ ] Plan-level "self-spec" exists in `specs/_shipped/cofounder-os-v1.md`

---

## Risks

| Risk | Mitigation |
|---|---|
| Founder edits `legacy/` directly, breaking the "frozen" rule | Add CI check: any change under `_COFOUNDER/legacy/` requires `[legacy-edit]` in commit message + ADR |
| ADR drift (decisions made in PRs without an ADR) | Verifier blocks any PR introducing a new pattern without an ADR cross-link |
| CHARTER changes silently | CHARTER edits require ADR + founder sign-off (per Decision Authority Matrix) |
| Glossary becomes a dumping ground | Doc-curator monthly sweep deduplicates; deprecated terms moved to `glossary-archive.md` |
| Force-push for secret scrub corrupts history | Backup branch + GitHub support contact noted in runbook before push |

---

## Dependencies

- **Blocks:** 02, 03, 04, 05, 06, 07 — every other plan depends on this one.
- **Blocked by:** §9.1 of `00_MASTER_INDEX.md` (legacy folder transfer).

---

## References

- `00_MASTER_INDEX.md` (this campaign)
- `_COFOUNDER/legacy/Projects/AgriSync/Operations/Plans/INDUSTRY_GRADE_HARDENING_2026-04-27/00_MASTER_INDEX.md` (predecessor)
- ADR template: `adr/_template.md` (created in Sub-phase 1.5 alongside ADR 0001)

---

*End of Plan 01.*
