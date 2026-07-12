using System.Text.RegularExpressions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// DFES (dfes-companion-2026-07-11) fitness test. ErasureWorker + ExportWorker are
/// HAND-CODED manifests: a new personal-data-adjacent ssf table that no one wired is a
/// silent DPDP §12 gap. This test asserts every ssf table created by a migration is
/// ACCOUNTED FOR — either NAMED in ErasureWorker.cs (an anonymize/delete action or a
/// conscious gate-4 KEEP disposition comment), or on ONE of two explicit baselines below.
/// A net-new table that is on neither forces a source edit → a PR review → the privacy
/// conversation. Mirrors RlsExemptionAllowlistTests' migration-scan approach.
///
/// <para><b>Two baselines, deliberately distinct (founder decision 2026-07-12 / 1B).</b>
/// <see cref="NoFarmerDataStructural"/> is the honest "structurally holds no farmer
/// personal data" set (system / lookup / queue / de-identified rollup tables). It is a
/// genuine no-disposition-needed claim. <see cref="PreExistingPendingDisposition"/> is the
/// OPPOSITE: pre-existing tables that ARE personal-data-adjacent and do NOT yet carry a
/// disposition — tracked DPDP follow-up DEBT (a separate compliance task, NOT blocking
/// DFES, and NOT a claim that they are PII-free). Keeping them on an explicit baseline is
/// what scopes this test so it does not retroactively fail on legacy debt.</para>
/// </summary>
public sealed class ErasureManifestCoverageTests
{
    // Structurally no farmer personal data — system/lookup/queue/de-identified-rollup
    // tables. A genuine "no disposition needed" claim (same rationale family as the RLS
    // exemption allowlist). NOTE: the 4 names crop_schedules / planned_activities /
    // schedule_templates / template_activities are NOT ssf CreateTable names and are
    // deliberately ABSENT — the real schedule tables are the crop_schedule_* /
    // schedule_subscription* / schedule_migration_events names below.
    private static readonly HashSet<string> NoFarmerDataStructural = new(StringComparer.Ordinal)
    {
        "outbox_messages", "cost_categories", "ai_provider_capabilities", "mode_policy",
        "diarization_policy", "feature_flags", "ai_provider_spend_daily", "dpa_registry",
        "crop_schedule_templates", "crop_schedule_prescribed_tasks",
        "schedule_subscriptions", "schedule_migration_events",
        "organizations", "organization_memberships", "organization_farm_scopes",
        "test_protocols", "test_recommendations", "test_instances",
        "erasure_requests", "export_requests", "retention_sweep_runs", "breach_incidents",
        "export_artifacts", "audit_read_telemetry", "pii_review_queue",
        "cross_border_transfers", "raw_blob_index", "transcripts",
        // Executor: run this test RED first, then add ANY remaining genuinely-no-PII
        // pre-existing ssf table the scan flags (core reference/config tables such as
        // price_configs, ai_provider_config, etc.) here with a one-line reason. Do NOT
        // add a personal-data-adjacent table here — those go on the pending baseline.
    };

    // Pre-existing personal-data-adjacent ssf tables that do NOT yet carry an explicit
    // erasure disposition. TRACKED-DEBT baseline — a separate DPDP compliance task, NOT
    // blocking DFES, and NOT a "no personal data" claim. farm_memberships /
    // farm_invitations / farm_join_tokens hold the member's identity, contact and role
    // (tracked follow-up — give these a real anonymize/KEEP disposition in the compliance
    // slice, not here). farm_boundaries / document_extraction_sessions / user_consent_state
    // likewise carry farm-geo / uploaded-doc / consent data pending disposition.
    private static readonly HashSet<string> PreExistingPendingDisposition = new(StringComparer.Ordinal)
    {
        "farm_memberships", "farm_invitations", "farm_join_tokens",
        "farm_boundaries", "document_extraction_sessions", "user_consent_state",
        // Flagged by the RED run (2026-07-12 executor pass). compliance_signals carries
        // acknowledged_by_user_id / resolved_by_user_id (actor columns) + a free-text
        // resolution_note. job_cards carries created_by_user_id / assigned_worker_user_id /
        // cancelled_by_user_id (actor columns) + a free-text cancellation_reason. Both are
        // pre-existing (AddComplianceSignalsTable / AddJobCardsTable, 2026-04-21) and
        // personal-data-adjacent with no disposition in ErasureWorker.cs yet — tracked DPDP
        // follow-up, NOT a "no personal data" claim, NOT blocking DFES.
        "compliance_signals", "job_cards",
        // Executor: confirm this set against the RED run. It must contain ONLY
        // pre-existing personal-data-adjacent tables that are (a) not named in
        // ErasureWorker.cs and (b) not structurally PII-free. It must NOT contain the two
        // net-new DFES tables (daily_richness_aggregates / question_events) — those get a
        // genuine gate-4 disposition in Task 6.2.
    };

    [Fact]
    public void Every_ssf_table_is_dispositioned_or_on_an_explicit_baseline()
    {
        var appsRoot = TestPathHelper.GetAppsRoot();
        var migrationsDir = Path.Combine(appsRoot, "ShramSafal", "ShramSafal.Infrastructure", "Persistence", "Migrations");
        var erasureWorkerPath = Path.Combine(appsRoot, "ShramSafal", "ShramSafal.Infrastructure", "Privacy", "ErasureWorker.cs");

        Assert.True(Directory.Exists(migrationsDir), $"migrations dir not found at {migrationsDir}");
        Assert.True(File.Exists(erasureWorkerPath), $"ErasureWorker.cs not found at {erasureWorkerPath}");

        var createTablePattern = new Regex(
            """CreateTable\s*\(\s*name:\s*"(?<table>[a-zA-Z0-9_]+)"\s*,\s*schema:\s*"ssf"\s*,""",
            RegexOptions.Compiled | RegexOptions.Singleline);

        var created = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in Directory.GetFiles(migrationsDir, "*.cs", SearchOption.TopDirectoryOnly)
                     .Where(p => !Path.GetFileName(p).EndsWith(".Designer.cs", StringComparison.Ordinal))
                     .Where(p => !Path.GetFileName(p).StartsWith("ShramSafalDbContextModelSnapshot", StringComparison.Ordinal)))
        {
            foreach (Match m in createTablePattern.Matches(File.ReadAllText(file)))
                created.Add(m.Groups["table"].Value);
        }
        Assert.NotEmpty(created);

        // A net-new DFES table must never hide on the pending-disposition debt list.
        Assert.DoesNotContain("daily_richness_aggregates", PreExistingPendingDisposition);
        Assert.DoesNotContain("question_events", PreExistingPendingDisposition);

        var worker = File.ReadAllText(erasureWorkerPath);
        var missing = created
            .Where(t => !NoFarmerDataStructural.Contains(t))
            .Where(t => !PreExistingPendingDisposition.Contains(t))
            .Where(t => !worker.Contains(t, StringComparison.Ordinal))
            .OrderBy(t => t, StringComparer.Ordinal)
            .ToList();

        Assert.True(missing.Count == 0,
            "These ssf.* tables are neither named in ErasureWorker.cs (scrub/delete action or gate-4 KEEP "
            + "disposition comment) nor on an explicit baseline: " + string.Join(", ", missing)
            + ". Add a disposition (anonymize/delete/KEEP-with-reason) in ErasureWorker.cs, or — only if it "
            + "structurally holds no farmer personal data — add it to NoFarmerDataStructural with a reason. "
            + "A pre-existing personal-data-adjacent table with no disposition yet goes on "
            + "PreExistingPendingDisposition (tracked DPDP follow-up).");
    }
}
