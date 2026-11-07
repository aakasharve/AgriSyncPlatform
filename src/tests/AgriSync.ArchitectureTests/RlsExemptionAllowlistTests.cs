// spec: data-principle-spine-2026-05-05/05.6
using System.Text.RegularExpressions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.6 — explicit allowlist of
/// <c>ssf.*</c> tables that ship WITHOUT Row-Level Security policies.
///
/// <para>
/// The default invariant is "every farm-scoped table in the
/// <c>ssf</c> schema is RLS-enabled" (Phase 03.3
/// <c>20260516130000_EnableRowLevelSecurity</c> +
/// <c>20260517010000_AddDeferredAuditRls</c>). Adding a new table that
/// does NOT have RLS forces a conscious choice — the implementor MUST
/// add the table name to <see cref="ExpectedRlsExemptions"/> below
/// alongside a comment explaining why.
/// </para>
///
/// <para>
/// <b>Why an allowlist not a denylist.</b> A denylist (the inverse —
/// list every RLS-enabled table) would silently accept a new table
/// without RLS. The allowlist forces a test change, which forces a PR
/// review, which forces the privacy / data-protection conversation
/// to happen before the table ships.
/// </para>
///
/// <para>
/// <b>How the test works.</b> Scans every <c>*.cs</c> migration in the
/// ShramSafal Infrastructure project. Extracts table names from
/// <c>migrationBuilder.CreateTable(name: "…", schema: "ssf", …)</c>
/// invocations. Extracts the set of RLS-enabled tables from
/// <c>ALTER TABLE ssf.{name} ENABLE ROW LEVEL SECURITY</c> statements
/// (which sit inside <c>migrationBuilder.Sql(@"…")</c> blocks).
/// Asserts every created table appears in either the RLS-enabled set
/// or the explicit <see cref="ExpectedRlsExemptions"/> set.
/// </para>
///
/// <para>
/// <b>OQ-5 verdict (cross_border_transfers exemption).</b> The
/// cross-border transfer log is admin-elevated on every read path
/// (Phase 08 export) and system-elevated on every write path
/// (<c>GeminiAiProvider</c> via <c>IAdminDbContextFactory</c>). Adding
/// RLS would force every consumer to elevate unnecessarily without
/// any payoff (no tenant ever sees this table). The grant boundary
/// (<c>SELECT, INSERT</c> only) carries the append-only invariant.
/// See ADR-DS-004 §RLS-Exemptions.
/// </para>
/// </summary>
public sealed class RlsExemptionAllowlistTests
{
    /// <summary>
    /// Tables in the <c>ssf</c> schema that are deliberately exempt
    /// from Row-Level Security. Add a new entry ONLY after the
    /// privacy + data-protection review has signed off — see class
    /// remarks for the policy.
    /// </summary>
    private static readonly HashSet<string> ExpectedRlsExemptions = new(StringComparer.Ordinal)
    {
        // ── Phase 08 net-new exemptions ──────────────────────────────

        // Phase 08.1 (per OQ-5 verdict on the 08.1 envelope) — DPDP
        // rights surface tables. All six are user-keyed admin-only
        // surfaces with no per-farm policy:
        //   - erasure_requests / export_requests: user-keyed queue rows
        //     read via IAdminDbContextFactory by the worker.
        //   - retention_sweep_runs: system-only writes (sweeper);
        //     admin-only reads.
        //   - breach_incidents: admin-only writes
        //     (POST /shramsafal/admin/breach/report) + admin-only reads.
        //   - export_artifacts: indexed S3 keys; system-only writes
        //     (ExportWorker), admin-only reads (sweeper).
        //   - audit_read_telemetry: privileged-read sample; admin-only
        //     reads via the breach-detection scaffolding.
        // The 20260520000000_DpdpRightsSurface migration's GRANT block
        // locks each table to the appropriate INSERT/UPDATE/SELECT
        // boundary (DELETE revoked across the board — sweeper uses the
        // admin-elevated factory).
        "erasure_requests",
        "export_requests",
        "retention_sweep_runs",
        "breach_incidents",
        "export_artifacts",
        "audit_read_telemetry",

        // ── Phase 10 net-new exemptions ──────────────────────────────

        // Phase 10.2 (OQ-6) — pii_review_queue is admin-only; reviewers
        // span all farms (allow-list claim, not membership). An RLS
        // policy keyed on agrisync.farm_id would evaluate NULL on every
        // request and filter every row. The grant boundary
        // (SELECT/INSERT/UPDATE; DELETE revoked) carries the
        // append-only invariant. See ADR-DS-012.
        "pii_review_queue",

        // ── Phase 06 net-new exemptions ──────────────────────────────

        // Phase 06.1 — user_consent_state + consent_audit are user-keyed
        // not farm-keyed. The Phase 03 RLS policy keyed on
        // agrisync.farm_id would filter every row out (the GUC is null
        // on the consent endpoints — they only have a sub claim, not a
        // farm_id claim). Defence-in-depth is at the handler boundary:
        // the endpoint reads `sub` from the JWT and the handler scopes
        // every read/write to that user via ICurrentUser. The grant
        // boundary further locks consent_audit to SELECT + INSERT only
        // (append-only by privilege, mirrors Phase 04 audit_events).
        // See ADR-DS-008 + the 20260519000000_ConsentDomain migration.
        "user_consent_state",
        "consent_audit",

        // Voice Diary ship (voice-diary-e2e-2026-05-17) —
        // voice_clips_retained is user-keyed (one row per retained
        // clip, PK is the client-supplied Dexie voiceClips.id). Same
        // posture as user_consent_state / consent_audit above: the
        // Phase 03 RLS policy keyed on agrisync.farm_id would filter
        // every row because the consent endpoints surface only the
        // `sub` claim. Defence in this ship is at the Application
        // layer — IRetainedBlobStore read paths take callerUserId
        // and the EF query scopes every read/write to it. Phase 07
        // layers RLS on top.
        "voice_clips_retained",

        // ── Phase 05 net-new exemptions ──────────────────────────────

        // Phase 05.6 (OQ-5) — admin-only read path, system-only write path.
        // ADR-DS-004 §RLS-Exemptions.
        "cross_border_transfers",

        // Phase 05.5 — DPA registry is a global lookup of vendor DPAs;
        // no tenant context applies (every vendor row is visible to
        // every admin tier reader). The startup gap-warning queries
        // this table during boot before any tenant claim exists; an
        // RLS policy keyed on agrisync.farm_id would filter every row
        // out. Mirrors the cost_categories pattern but without an
        // explicit FORCE/SELECT(true) policy (the warning runs as the
        // admin/owner role per the elevated InitializeApplicationDataAsync
        // scope, so a USING (true) read policy is not even needed).
        "dpa_registry",

        // ── Pre-Phase-05 incumbents ─────────────────────────────────
        // The following tables predate the Phase 03 RLS migration and
        // were never enrolled. Each entry below records the reason
        // the table sits outside the per-tenant policy gate today so
        // a future RLS audit pass has the rationale on file. This is
        // an inventory, NOT an endorsement — Phase 09 / Phase 11 may
        // close some of these gaps; until then the test holds the
        // line on "no new no-RLS table without a deliberate add to
        // this list".

        // T-IGH-03-OUTBOX-WIRING global message queue. Polled by the
        // OutboxDispatcher hosted service which runs without any
        // tenant claim; RLS keyed on farm_id would filter the entire
        // poll batch.
        "outbox_messages",

        // Schedule templates are author-owned, not farm-owned (CEI §4.5):
        // the template author can be a platform admin and the same
        // template is shared across many farms. A farm-scoped RLS policy
        // would not represent the access shape; a future author-scoped
        // policy is the right tool.
        // spec: plr-d10 lane L8b-1 — schedule_subscriptions and
        // schedule_migration_events LEFT this list: they are ONE farm's
        // choices (each row carries farm_id), not author-owned, and are
        // FORCE-RLS'd on farm_id by 2026110*_AddScheduleSubscriptionDayZeroAndRls.
        "crop_schedule_templates",
        "crop_schedule_prescribed_tasks",

        // Organization tables (W0 admin spine). Multi-tenant by
        // org_id not farm_id; a future Phase 09 RLS policy will key
        // on agrisync.organization_id once the GUC is wired through
        // TenantConnectionInterceptor.
        "organizations",
        "organization_memberships",
        "organization_farm_scopes",

        // Farm-adjacent metadata that lives outside the farms table
        // proper.
        //
        // 🛑 CORRECTED (FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.3).
        // This entry used to read "accessed only via that join in the
        // application layer … no direct SELECT path exists" and used to
        // cover farm_boundaries as well. Both halves were false.
        //   - farm_boundaries had a direct SELECT
        //     (ShramSafalRepository.GetActiveFarmBoundaryAsync) from the
        //     day the table shipped, and is now RLS-enabled + FORCEd by
        //     20260815115414_AddFarmBoundariesRls — removed from this list.
        //   - The two entries that REMAIN have direct SELECT paths too:
        //     FarmInvitationRepository.GetActiveInvitationByFarmAsync reads
        //     ssf.farm_invitations directly, and GetTokenByHashAsync reads
        //     ssf.farm_join_tokens keyed on the token hash ALONE, with no
        //     farm in the predicate at all. So the reason they sit outside
        //     the gate is NOT "there is no direct read" — it is that nobody
        //     has yet chosen the policy shape (a join-invite flow is read by
        //     a caller who is deliberately NOT yet a member of the farm, so
        //     a farm_id-keyed policy would break the invite it is meant to
        //     protect). That is a real open design question, recorded here
        //     honestly rather than papered over. Tracked for a follow-up
        //     RLS pass; do not restore the old justification.
        "farm_invitations",
        "farm_join_tokens",

        // Document-extraction sessions: extraction is request-scoped
        // and rows are looked up by id; no current cross-tenant
        // enumeration path. Future-RLS candidate.
        "document_extraction_sessions",

        // CEI test stack lookup tables. Test protocols + recommendations
        // are author-owned global libraries; test_instances IS RLS'd
        // (it carries farm_id). The two lookups here have no per-farm
        // dimension. Same pattern as cost_categories but without the
        // explicit SELECT(true) policy.
        "test_protocols",
        "test_recommendations",

        // SARVAM_PRIMARY_VOICE_PIPELINE Task 1.2 — global capability matrix
        // mirror of _COFOUNDER/Projects/AgriSync/Architecture/CAPABILITY_MATRIX.md.
        // No farm dimension; rows describe (provider × operation × mode) →
        // (supports_streaming, cost_per_unit_inr, sla_ttft_ms) for the
        // AiOrchestrator's runtime routing decisions. Admin-managed via
        // the /shramsafal/ai/config admin surface; same pattern as
        // cost_categories without the explicit SELECT(true) policy.
        "ai_provider_capabilities",

        // SARVAM_PRIMARY_VOICE_PIPELINE Task 1.3 (Safeguard S4) —
        // re-transcription audit ledger. Keyed on
        // (audio_content_hash, provider, model_version, mode); no farm
        // dimension. Audit replay queries run via admin-elevated
        // contexts; the Phase 03 RLS policy keyed on agrisync.farm_id
        // would filter every row out.
        "transcript_history",

        // SARVAM_PRIMARY_VOICE_PIPELINE Task 1.4 (Safeguard S7) —
        // admin-managed global feature flags. Backs cohort rollout for
        // the Sarvam pipeline + verbatim corpus sampling + selective
        // diarization. No farm dimension; reads happen during runtime
        // gating before any tenant claim exists.
        "feature_flags",

        // SARVAM_PRIMARY_VOICE_PIPELINE Task 1.5 (ADR-DS-016) —
        // data-driven trigger → Sarvam-STT-mode-list policy. Global
        // operational lookup read by the voice worker on every clip
        // evaluation. No farm dimension; same pattern as
        // ai_provider_capabilities above.
        "mode_policy",

        // SARVAM_PRIMARY_VOICE_PIPELINE Task 1.5a (founder blocker #4) —
        // diarization-as-capability policy (separate from mode_policy
        // because diarization is NOT a Sarvam STT mode). Global
        // operational lookup; same RLS posture as mode_policy.
        "diarization_policy",

        // SARVAM_PRIMARY_VOICE_PIPELINE Task 2.7 (Safeguard S9) —
        // daily cost rollup of estimated AI provider spend. Admin
        // managed; the AiCostBudgetGuard worker writes via an
        // admin-elevated DbContext on a fixed cadence. The
        // tenant_id column is recorded for future per-tenant budgets
        // but the rollup itself has no farm dimension — a Phase 03
        // RLS policy keyed on agrisync.farm_id would filter every row.
        // The /shramsafal/admin/ai-spend surface (future) reads this
        // table only with admin elevation. Same posture as
        // ai_provider_capabilities + mode_policy.
        "ai_provider_spend_daily",

        // SARVAM_PRIMARY_VOICE_PIPELINE Task 3.3 (data-eng Theme B-2,
        // Safeguard B2) — golden-set feedback-loop candidate ledger.
        // Training-corpus surface; user_id + farm_id are present on
        // every row but write semantics are admin-elevated via the
        // GoldenSetFeedbackWorker (system-elevated background
        // service) and reads happen only from the future promote
        // batch + admin surfaces. The Phase 03 RLS policy keyed on
        // agrisync.farm_id would filter the worker's writes (the
        // worker runs without a tenant claim). Same posture as
        // voice_clips_retained: defence at the worker boundary +
        // admin-only read paths; Phase 11+ may layer a future
        // training-corpus policy. The DPDP §12 erasure cascade
        // (Task 3.4) drops rows where user_id matches the target
        // user.
        "golden_set_candidate",

        // ── Raw-SQL incumbents (surfaced by plr-d10 lane L8b-1 fix round 1, review H1) ──
        // These tables were created by RAW SQL (CREATE TABLE IF NOT EXISTS ssf.… inside migrationBuilder.Sql) in the
        // February 2026 migrations, so this scan, which read only migrationBuilder.CreateTable, never saw them: they sat
        // outside both the RLS set and this list without anyone choosing that. The scan now reads raw SQL too. Each entry
        // below is an INVENTORY of a gap that was already open, NOT a reviewed exemption: the orchestrator registers each
        // for a later RLS lane, and removing one here means putting it under FORCE RLS in a migration.

        // spec: plr-d10 lane RLS-2 (F113) — planned_activities, day_ledgers, day_ledger_allocations, log_tasks and the
        // February share lines (live name day_ledger_plot_allocations_legacy_financev2, see the rename note in the scan)
        // LEFT this list: 20261107034303_AddRlsToDayLedgersLogTasksAndPlannedActivities puts them under FORCE RLS.

        // Author-owned, not farm-owned (the same reason as crop_schedule_templates above): a schedule row belongs to the
        // account that made it, and the library is shared. The wall is the application's one visibility rule
        // (ShramSafal.Application.Services.ScheduleViewer: Public, his own, his team's), asked by every door that lists,
        // adopts, copies or changes a row (lane L8b-1 fix round 1, H2/H3). Its tasks follow it.
        "schedule_templates",
        "template_activities",

        // The idempotency store: keyed on (device id, client request id); written and read by the sync layer inside the
        // caller's request. No farm dimension.
        "sync_mutations",

        // Global lookups / settings with no farm dimension (the cost_categories pattern without its explicit policies).
        "price_configs",
        "ai_provider_configs",
    };

    [Fact]
    public void Every_ssf_table_either_enables_rls_or_is_on_the_exemption_allowlist()
    {
        var migrationsDirectory = Path.Combine(
            TestPathHelper.GetAppsRoot(),
            "ShramSafal",
            "ShramSafal.Infrastructure",
            "Persistence",
            "Migrations");

        Assert.True(
            Directory.Exists(migrationsDirectory),
            $"ShramSafal migrations directory not found at {migrationsDirectory}.");

        var migrationFiles = Directory
            .GetFiles(migrationsDirectory, "*.cs", SearchOption.TopDirectoryOnly)
            .Where(p => !Path.GetFileName(p).EndsWith(".Designer.cs", StringComparison.Ordinal))
            .Where(p => !Path.GetFileName(p).StartsWith("ShramSafalDbContextModelSnapshot", StringComparison.Ordinal))
            .ToList();

        var allCreatedTables = new HashSet<string>(StringComparer.Ordinal);
        var rlsEnabledTables = new HashSet<string>(StringComparer.Ordinal);

        // CreateTable invocations specifying schema: "ssf".
        // Example match:
        //   migrationBuilder.CreateTable(
        //       name: "cross_border_transfers",
        //       schema: "ssf",
        var createTablePattern = new Regex(
            """CreateTable\s*\(\s*name:\s*"(?<table>[a-zA-Z0-9_]+)"\s*,\s*schema:\s*"ssf"\s*,""",
            RegexOptions.Compiled | RegexOptions.Singleline);

        // spec: plr-d10 lane L8b-1 fix round 1 (review H1) — tables created by RAW SQL inside migrationBuilder.Sql(...)
        // count too. The early migrations (20260218073025_FinanceV2, 20260222080909_AddAuditEvents, ...) created tables
        // with `CREATE TABLE IF NOT EXISTS ssf.name (...)`, which the CreateTable pattern above never saw: ten tables,
        // ssf.planned_activities among them, sat outside both the RLS set and this list without anyone choosing that.
        // Example matches:
        //   CREATE TABLE IF NOT EXISTS ssf.planned_activities (
        //   CREATE TABLE ssf."some_table" (
        var rawCreateTablePattern = new Regex(
            """CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?ssf"?\."?(?<table>[a-zA-Z0-9_]+)"?\s*\(""",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        // ENABLE ROW LEVEL SECURITY statements inside raw SQL.
        // Example matches:
        //   ALTER TABLE ssf.daily_logs ENABLE ROW LEVEL SECURITY;        ← literal
        //   ALTER TABLE ssf.{t} ENABLE ROW LEVEL SECURITY;               ← string-interpolated loop
        // We accept both; the loop variant is paired with a C# array
        // literal (see DirectFarmScopedTables / similar) that the second
        // regex below extracts.
        var enableRlsPattern = new Regex(
            """ALTER\s+TABLE\s+ssf\.(?<table>[a-zA-Z0-9_]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY""",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        // The Phase 03 RLS migration loops over an array of table names
        // (DirectFarmScopedTables) and emits ALTER TABLE statements via
        // string interpolation. The ALTER TABLE line therefore reads
        // `ALTER TABLE ssf.{t} ENABLE ROW LEVEL SECURITY` literally in
        // the source — the placeholder doesn't survive a regex grep.
        // Instead, when we see `ssf.{t}` we look for a same-file C#
        // string[] literal whose elements are the table names.
        var loopRlsPattern = new Regex(
            """ALTER\s+TABLE\s+ssf\.\{t\}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY""",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        // Capture the contents of any `string[] … = { "a", "b", … };`
        // initializer in the file. Used to expand the loop-driven RLS
        // ALTERs above into the concrete table-name set.
        var arrayLiteralPattern = new Regex(
            """string\[\][^=]*=\s*\{(?<entries>[^}]*)\}""",
            RegexOptions.Compiled | RegexOptions.Singleline);

        var quotedStringPattern = new Regex(
            """ "(?<s>[^"]+)" """,
            RegexOptions.Compiled | RegexOptions.IgnorePatternWhitespace);

        // spec: plr-d10 lane RLS-2 — a table RENAMED by raw SQL is judged under the name it LIVES under. FinanceV2 created
        // ssf.day_ledgers and ssf.day_ledger_plot_allocations; AddPhase7DayLedgerAndModifiedAt renamed both to
        // *_legacy_financev2 and created a new ssf.day_ledgers. Read by creation name only, the scan demanded RLS on a
        // table no database has (day_ledger_plot_allocations) and never saw the two tables every database does have.
        // Statements are applied in migration order (file name = timestamp), and in text order within a file.
        //   ALTER TABLE ssf.day_ledgers RENAME TO day_ledgers_legacy_financev2;
        var renameTablePattern = new Regex(
            """ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?ssf"?\."?(?<from>[a-zA-Z0-9_]+)"?\s+RENAME\s+TO\s+"?(?<to>[a-zA-Z0-9_]+)"?""",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        foreach (var file in migrationFiles.OrderBy(Path.GetFileName, StringComparer.Ordinal))
        {
            var text = File.ReadAllText(file);
            var tableStatements = createTablePattern.Matches(text)
                .Concat(rawCreateTablePattern.Matches(text))
                .Select(m => (m.Index, Created: m.Groups["table"].Value, From: (string?)null))
                .Concat(renameTablePattern.Matches(text)
                    .Select(m => (m.Index, Created: m.Groups["to"].Value, From: (string?)m.Groups["from"].Value)))
                .OrderBy(s => s.Index);
            foreach (var (_, created, from) in tableStatements)
            {
                if (from is not null && !allCreatedTables.Remove(from))
                {
                    continue; // a rename of a table this scan never saw created: not an ssf table it tracks
                }

                allCreatedTables.Add(created);
            }

            foreach (Match m in enableRlsPattern.Matches(text))
            {
                rlsEnabledTables.Add(m.Groups["table"].Value);
            }

            if (loopRlsPattern.IsMatch(text))
            {
                foreach (Match arr in arrayLiteralPattern.Matches(text))
                {
                    foreach (Match s in quotedStringPattern.Matches(arr.Groups["entries"].Value))
                    {
                        rlsEnabledTables.Add(s.Groups["s"].Value);
                    }
                }
            }
        }

        Assert.NotEmpty(allCreatedTables);

        var unprotected = allCreatedTables
            .Where(t => !rlsEnabledTables.Contains(t))
            .Where(t => !ExpectedRlsExemptions.Contains(t))
            .OrderBy(t => t, StringComparer.Ordinal)
            .ToList();

        Assert.True(
            unprotected.Count == 0,
            $"The following ssf.* tables have no ENABLE ROW LEVEL SECURITY statement and are not on the explicit RLS-exemption allowlist: "
                + string.Join(", ", unprotected)
                + ". Either enable RLS in a follow-up migration, or add the table to "
                + nameof(ExpectedRlsExemptions)
                + " in this test file alongside a comment explaining why.");
    }
}
