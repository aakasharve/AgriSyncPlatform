// spec: data-principle-spine-2026-05-05/10.1
namespace ShramSafal.Infrastructure.Privacy;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.1 — options class bound
/// to the <c>Pii:</c> configuration section. Per OQ-3 verdict, the
/// detector's auto-redact / discard thresholds are operator-tunable
/// via appsettings rather than baked into source; per OQ-6 the
/// reviewer allowlist also lives here (promotes to a DB table at &gt;5
/// reviewers).
///
/// <para>
/// <b>Deviation from envelope.</b> The envelope places this file under
/// <c>ShramSafal.Api/Configuration/</c>, but
/// <see cref="HeuristicWorkerNameDetector"/> in Infrastructure must
/// read these thresholds — and Infrastructure cannot project-reference
/// Api. The other options classes (<c>GeminiOptions</c>,
/// <c>SarvamOptions</c>, <c>AiPromptOptions</c>) follow the same
/// pattern: type lives in Infrastructure, binding happens in Api's
/// <c>DependencyInjection.cs</c>. Co-locating PiiOptions with its
/// sole consumer (the detector adapter) avoids the project-reference
/// cycle without losing any functionality.
/// </para>
///
/// <para>
/// <b>Defaults.</b> <see cref="AutoRedactThreshold"/> 0.85 +
/// <see cref="DiscardThreshold"/> 0.3 mirror the plan body. Re-
/// calibration is documented in
/// <c>_COFOUNDER/Projects/AgriSync/Operations/Plans/DATA_PRINCIPLE_SPINE_2026-05-05/probes/pii_threshold_calibration.md</c>.
/// </para>
/// </summary>
public sealed class PiiOptions
{
    public const string SectionName = "Pii";

    /// <summary>
    /// Detection score at or above which the redaction is applied
    /// automatically and an audit-trail review-queue row is written.
    /// </summary>
    public decimal AutoRedactThreshold { get; set; } = 0.85m;

    /// <summary>
    /// Detection score at or below which the result is treated as
    /// clean (no review queue row, transcript persists verbatim). The
    /// review queue band is (<see cref="DiscardThreshold"/>,
    /// <see cref="AutoRedactThreshold"/>).
    /// </summary>
    public decimal DiscardThreshold { get; set; } = 0.3m;

    /// <summary>
    /// User-ids permitted to act on the admin review queue. Empty in
    /// the shipped defaults — operators populate via appsettings.
    /// Bound from <c>Pii:ReviewerUserIds</c> (string array of GUIDs).
    /// </summary>
    public string[] ReviewerUserIds { get; set; } = Array.Empty<string>();
}
