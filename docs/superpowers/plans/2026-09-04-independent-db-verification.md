# Independent Database Verification + Hook Bypass Closure

**Spec:** `_COFOUNDER/specs/_active/2026-09-04-independent-db-verification.md`
**Founder ruling:** 2026-09-04 — Option 1, database-enforced read-only identity.
**Founder ruling 2026-09-05 (migration gate):** `ALLOW_PRODUCTION_STARTUP_MIGRATIONS`
stays **false** as the normal production state. Labour V2 gets an explicit **bounded
migration phase** instead — expected-before state, exact approved MigrationIds,
expected-after state, zero undeclared migrations, fail-closed if the set differs,
snapshot floor, restored-copy rehearsal, and independent read-only verification both
after rehearsal and after production application. "Deploy the API" must never
implicitly mean "apply every pending migration across every context". Proposal due
after Tasks 1-5; no production mutation before it is approved.
**Tier:** Data-prod (`trust_tier: high`) — touches RLS posture, prod IAM, prod DB roles. No EF migration.
**Supervisor:** senior-architect Pre-Flight Brief, 2026-09-04.

## The invariant this exists to enforce

> The agent that changes production must never be the only agent capable of proving
> the resulting database truth.

Safety comes from PostgreSQL permissions and AWS IAM — never from instructions asking an
agent to "please run read-only SQL".

---

## Verified ground truth (measured, not assumed)

| Fact | Value | Source |
|---|---|---|
| `agrisync_readonly` exists in prod | yes, `GRANT SELECT ON ALL TABLES IN SCHEMA ssf` | `20260515090000_BootstrapDbRoles.cs:82,90` |
| …but is an **application** credential | `ConnectionStrings__*_ReadOnly` on the app box; `GRANT agrisync_readonly TO agrisync_app` | `appsettings*.json`, `prod-db-bootstrap.sql:89` |
| Migration **files** at `7f5de637` | **107** | `git ls-tree` |
| Migration **files** at deployed `7644ee62` | **102** | `git ls-tree` |
| `ssf.__ef_migrations` rows claimed in prod | **101** — one behind the binary's own set, unexplained | chart `473afc26:1032` |
| `ALLOW_PRODUCTION_STARTUP_MIGRATIONS` in prod | **false**, and **not ssf-only** (6 apply phases / 4 contexts) | chart `:358`, `:261` |
| `ssf.attendance_marks` policies | **two** — `p_tenant_attendance_marks` **and** `p_user_select_attendance_marks` | `20260831180408_AddAttendanceMarks.cs` |
| Smoke tests 6.1–6.7 | **do not exist**; the string appears once, in a narrative spec paragraph | `grep` across repo + spec |
| App error telemetry | **none published**. No `PutMetricData`, no CloudWatch sink. OTel + Prometheus exist in-process | `OpenTelemetryConfig.cs`, `ExportWorker.cs:280` |
| PreToolUse hook | **LIVE** (its own header saying "NOT YET LIVE" is stale) | `.claude/settings.json` |

**Counts are forbidden in assertions.** Three mutually inconsistent counts already exist above.
Every assertion names a `MigrationId`.

---

## Change Surface

**DB** — One new PostgreSQL login role `agrisync_deploy_verifier` on the prod primary, created by
recorded one-off DDL (not an EF migration — see §Decision 1). Grants: `CONNECT` on the database,
`USAGE` on `ssf` + `public`, `SELECT` on exactly `ssf."__ef_migrations"` and
`public."__ef_migrations"`. Nothing else. No table in `ssf` beyond the history table. No
`BYPASSRLS`, no `SUPERUSER`, no `pg_read_all_data`, no membership in any writer role.
`ALTER ROLE … SET default_transaction_read_only = on` as defence-in-depth only.
No EF migration, no schema change, `ssf.__ef_migrations` unchanged by this work.

**Backend** — No Backend changes. (The verifier reads the catalogue; it does not run in the API.)

**Frontend** — No Frontend changes.

**Cross-cutting** — New AWS SSM document `AgriSync-VerifySchema` (parameterised assertions, no
free-form shell). New Secrets Manager secret for the verifier credential. New IAM policy scoping
`ssm:SendCommand` to that document + instance only, with **no** grant on `AWS-RunShellScript`.
Hook detector D6 added to **both** `deploy-block-check.sh` and `deploy-lock.sh` (the D1–D5 blocks
are deliberately duplicated; patching one is the bug pattern). `release-verifier.md` charter line
amended precisely. `allowlist-tier-scoped.json` gains one prefix with `--document-name` **first**
(prefix matching is order-dependent). No AI prompt change, no golden set, no SharedKernel event.

---

## Decision 1 — how the role is born: recorded one-off DDL, not an EF migration

Recommended by senior-architect; adopted. Five reasons, each verified:

1. **A migration would not apply.** `ALLOW_PRODUCTION_STARTUP_MIGRATIONS=false`. "Rides Labour V2's
   deploy" is false today, and flipping that gate is a separate decision affecting 4 contexts.
2. **A password cannot live in a migration.** `BootstrapDbRoles.cs:82` proves the failure mode by
   hardcoding `'dev_ro_change_me'`. You would create the role `NOLOGIN` and still run a one-off.
3. **Chicken-and-egg gets worse.** The migration creating the verifier would sit inside the
   migration set the verifier exists to check, delivered by the deploy we want verified.
4. **`Down()` is the wrong reversal.** `DROP ROLE` fails when the role owns or is referenced, and
   would run silently inside a rollback. The correct reversal is `REVOKE` + `NOLOGIN` + destroy the
   secret — not a migration shape.
5. **Wrong owner.** The verifier reads both `ssf` and `public` history. A ShramSafal migration is
   the wrong home for a cross-context identity.

Pattern to copy, not invent: `DEPLOY_PLAN_TRUST_SPINE_7f68ceb2_RETRY_2026-05-22.md` §0.2 already
provisioned `agrisync_readonly` this way — password generated into Secrets Manager, passed to psql
as a variable, never a literal, idempotent, fail-loud post-check.

**Rulebook §4 ("no out-of-band DB changes") is honoured, not bypassed:** the 2026-08-25
`memory/corrections.md` entry settles the reading — §4 forbids *silent drift while `/version` is
unchanged*, not a *recorded* maintenance step. This step is recorded on a chart and in the tracker.

**Sequencing consequence:** the role must exist **before** Labour V2 deploys, or the first thing it
verifies is a deploy that already happened.

## Decision 2 — where read-only actually comes from

Ranked by whether a confused or hostile caller can talk it out of the guarantee:

| Mechanism | Structural? |
|---|---|
| Role with no write grants, no writer-role membership | **Yes** — PG engine enforces. The floor. |
| SSM document that cannot run arbitrary shell + IAM denying `AWS-RunShellScript` | **Yes**, at transport. Constrains *who may ask*. |
| Fixed assertion catalogue, no free-form SQL | Only **in combination** with the above; alone it fails open the moment the transport is called directly — today's exact defect. |
| `SET default_transaction_read_only` | **No** — any session can `SET … = off`. Keep as free extra, never as the guarantee. |
| Read-only replica | **Rejected** — new infra, violates R19 primary-only, and replica lag answers "did migration N land?" *confidently wrong*. A `P4` defect. |
| Regex "SQL looks safe" | Excluded by founder. `prod_db_read.py:87-95` escapes four metacharacters and none of it makes `DELETE FROM ssf.attendance_marks` safe. |

**Adopted: rows 1 × 2 × 3, with 4 as defence-in-depth.** Anything leaving `AWS-RunShellScript` in
the path is not structural, because that document *is* the arbitrary-code primitive.

**The assertion set needs almost no table grants.** `TableExists`, `RlsEnabled`/`RlsForced`,
`PolicyExists`, `GrantExists` are all answerable from `pg_catalog` / `information_schema`, which any
role reads without a GRANT and without RLS. Only `MigrationApplied` needs a real `SELECT`, on two
history tables. **Zero farmer rows, ever.**

## Decision 3 — the transport

`/ops/schema-assert` on the existing API is **rejected and named here because someone will propose
it**: it places the verifier's proof *inside the binary being verified*. Ship the wrong binary and
the endpoint lies confidently.

SSM is unavoidable (RDS is private). Minimum-authority form: document `AgriSync-VerifySchema`,
`schemaVersion 2.2`, whose parameters are **not a command string** — one `assertion` parameter whose
`allowedValues` *is* the catalogue, plus typed args constrained by `allowedPattern`. SQL lives in the
document body; the caller cannot supply SQL. Credential resolved from Secrets Manager, never from
`/opt/agrisync/api/.env`.

IAM is what makes it real: `ssm:SendCommand` on that document ARN + that instance ARN, with **no**
grant on `AWS-RunShellScript`. That converts the verifier's markdown charter line into an
AWS-enforced fact.

**Environment separation (founder directive 5):** G2 rehearsal and G5 production resolve *different
secrets and different targets*. "Which environment" is never a runtime string argument — it is a
different credential the caller cannot reach, so a rehearsal physically cannot point at production.

---

## Tasks

### Task 1 — Measure prod truth before designing against it
- [ ] 1.1 Resolve the **101 vs 102** gap: which `MigrationId` is in the binary's set but not in
      `ssf.__ef_migrations`. Report the id; do not guess.
- [ ] 1.2 Confirm `agrisync_readonly` still holds its grants, and that `agrisync_deploy_verifier`
      does not already exist.
- [ ] 1.3 Enumerate `SECURITY DEFINER` functions in `ssf` + `public` (`pg_proc.prosecdef`). PG16
      grants `EXECUTE` to `PUBLIC` by default — such a function owned by a writer is a write path
      that survives every revocation.
- [ ] 1.4 Confirm `ssf.attendance_marks` / `ssf.attendance_mark_corrections` are **absent** in prod
      (expected — Labour V2 not deployed).
- [ ] Verify: every value recorded with the measuring role named alongside it. A `0` row count is
      never accepted as proof — under RLS it is an artifact.

### Task 2 — Close the hook bypass (do this FIRST: zero prod risk, closes a live hole)
- [x] 2.1 Add detector **D6** to `deploy-block-check.sh`: classify by **script basename,
      independent of interpreter**, for the prod-capable set enumerated in `deploy-core/MANIFEST.md`
      — `prod_db_read.py`, `check-retighten-state.py`, `prod-drift-guard.py`. Do **not** ban Python.
- [x] 2.2 Mirror D6 into `_COFOUNDER/scripts/lock/deploy-lock.sh` (D1–D5 are duplicated there by
      design; patching one is the bug pattern).
- [x] 2.3 Fix the stale `NOT YET LIVE` header — the hook has been live since Phase 4B.
- [x] 2.4 Regression tests in `tests/integration/test_hook_block.sh` as Tests 10+, proving
      `python …/prod_db_read.py` is now blocked, and that D1–D5 behaviour is unchanged.
- [x] Verify: new tests fail before 2.1, pass after; full existing suite still green.
- [ ] **Add D6; do NOT refactor D1–D5.** That code gates every prod mutation; a regression there is
      worse than the hole.

### Task 3 — Role + SSM document + IAM, rehearsed on a clone first
- [x] 3.1 Author the idempotent DDL (`CREATE ROLE … NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
      NOREPLICATION`, password via psql variable from Secrets Manager) + the minimum grant set.
- [x] 3.2 Author `AgriSync-VerifySchema` SSM document + the scoped IAM policy.
- [ ] 3.3 **Rehearse both on the G2 clone**, never prod first. Execute the reversal (`REVOKE` +
      `NOLOGIN` + destroy secret) on the clone — tested, not described (`E8`).
- [ ] 3.4 🛑 Founder-supervised session: apply to prod primary. `aws ssm create-document` is itself
      a prod mutation no allowlist covers — same session, same supervision.
- [ ] 3.5 **Assertion #0 — negative-control self-test**, run by the new role, witnessed:
      `rolsuper`/`rolbypassrls`/`rolcreatedb`/`rolcreaterole`/`rolinherit` all false; `INSERT` and
      `CREATE TABLE` both raise `42501`; `SET ROLE agrisync_app` and `SET ROLE agrisync_readonly`
      both fail; `SELECT` on `ssf.daily_logs` raises **`42501`, not zero rows**.
- [ ] Verify: recorded honestly as **bootstrap-time self-attestation, not independent
      verification** — we cannot use the verifier to verify its own creation, and claiming otherwise
      is the exact `P4` failure this task exists to fix.

### Task 4 — The assertion catalogue
- [x] 4.1 Implement `MigrationApplied(id)`, `TableExists`, `RlsEnabled`, `RlsForced`,
      `PolicySetMatches`, `GrantExists`, `RoleSelfAttest`.
- [x] 4.2 **`PolicySetMatches`, not `PolicyExists`.** `ssf.attendance_marks` carries **two**
      policies — `p_tenant_attendance_marks` and the permissive `p_user_select_attendance_marks`.
      Asserting membership would pass green while the OR-ed permissive policy was missing, added, or
      silently altered (doctrine `E4`: visible ≠ authorised). Assert the exact set: count, names,
      permissive/restrictive, and command.
- [ ] 4.3 Wire into `release-verifier` (G5, prod) and `database-guardian` (G2, clone). G2 must fit
      hook step 2b's unconditional constraints: no `$()`, no backticks, no `;`/`&&`/`||`/newline
      outside quotes.
- [ ] Verify: a deliberately wrong assertion FAILS. A catalogue that cannot fail proves nothing.

### Task 5 — Minimum telemetry + a real smoke contract
- [ ] 5.1 🛑 **Founder picks the one real error signal** (see Open Decisions). Strongest existing
      candidate: the `LogMutationRejected` literal at `PushSyncBatchHandler.cs:198`, already designed
      as the cheapest CloudWatch Logs metric-filter target.
- [ ] 5.2 Publish that one signal. No CloudWatch agent, no EMF pipeline, no ECS collector, no
      Grafana. The ECS/Grafana design in `aws/otel-collector/` is explicitly **out of scope**.
- [x] 5.3 Add a real `NO_DATA` state to `cloudwatch-spike-check`. Its verdict enum is today
      `GREEN | SPIKE | UNREACHABLE` where `UNREACHABLE` means API failure only — so a metric that
      never existed scores GREEN.
- [x] 5.4 **Delete the phantom 6.1–6.7 contract** and replace with a small real one (founder Option
      B). Update `smoke-test-suite/SKILL.md` (incl. its "all 7 smoke scripts" pass fixture) and
      `release-verifier.md:16`. For Labour V2 the set must at minimum prove health, version, and the
      attendance path.
- [x] Verify: zero datapoints returns `NO_DATA`, never `GREEN`. Every named test resolves to a file
      that exists.

---

## 🛑 Founder Acceptance Gate

Blocks Task 3.4 (the prod DDL session) and everything after it.

| # | Check | How | Expected |
|---|---|---|---|
| 1 | Hook bypass closed | `bash _COFOUNDER/plugins/agrisync-deploy/tests/integration/test_hook_block.sh` | exit 0, Tests 10+ present and passing |
| 2 | Bypass genuinely blocked | run the hook against `python …/prod_db_read.py` | BLOCKED (was: silently allowed) |
| 3 | Clone rehearsal green | Task 3.3 output | role created, all negative controls raise `42501`, reversal executed |
| 4 | No farmer data reachable | Task 3.5 assertion #0 | `SELECT` on `ssf.daily_logs` → `42501`, **not** `0 rows` |
| 5 | Smoke contract real | `grep smoke-6` across repo | zero hits; every named test resolves to a file |

**Founder approved: [ ]**

---

## Deployment Plan

**No application deployment occurs in this work** (founder DoD #11). No binary swap, no
`/version` change, no EF migration.

Two production mutations do occur, both in one founder-supervised session (Task 3.4), both recorded:
1. `CREATE ROLE agrisync_deploy_verifier` + minimum grants on the prod primary.
2. `aws ssm create-document AgriSync-VerifySchema` + the scoped IAM policy.

- [ ] Fresh deploy chart for the maintenance session; RDS snapshot taken first.
- [ ] Rollback: `REVOKE` + `ALTER ROLE … NOLOGIN` + destroy the Secrets Manager secret + delete the
      SSM document. **Executed on the clone at 3.3, not merely written down.**
- [ ] `DEPLOYMENT_TRACKER.md` row recording both mutations and the self-attestation result.
- [ ] Then, and only then: fresh `/deploy` pre-flight for `7f5de637` — with G2 and G5 able to
      verify the database for the first time.

---

## Open Decisions (founder)

1. **The one real error signal (blocks Task 5).** There is no numerator today — verified: no
   `PutMetricData` anywhere in `src/`, and `ExportWorker.cs:280` states outright *"There is no
   CloudWatch Logs sink, no metric filter anywhere."* So `cloudwatch-spike-check` has been querying
   a metric that never existed. Recommendation: `LogMutationRejected`.

2. **The 101 vs 102 migration gap.** Prod claims one fewer applied migration than the deployed
   binary carries, and that 100→101 figure was itself never independently verified. Task 1.1
   measures it. If the answer is surprising, it is a founder ruling, not an executor call.

3. **`ALLOW_PRODUCTION_STARTUP_MIGRATIONS=false` blocks Labour V2's five migrations from applying
   on boot** — and the gate is **not** ssf-only; opening it unblocks pending migrations across four
   contexts. This is a Labour V2 deploy decision, surfaced here because it was discovered here.
   Out of scope for this plan.

## Explicitly out of scope

SQL console · admin DB browser · generic prod access · developer query tool · the ECS/Grafana
observability project · investigating the 2026-08-31 `CommandsFailed=1` anomaly (founder directive
8) · `_COFOUNDER/Agrisync_Credentials/` (directive 9 — verified safe: its own `.gitignore` is `*`
with exceptions only for itself and `README.md`; `CREDENTIALS.md` is ignored, nothing is tracked) ·
Multi-User · Stage A1 · Network Credit.
