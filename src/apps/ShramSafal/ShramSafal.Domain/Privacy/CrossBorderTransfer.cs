// spec: data-principle-spine-2026-05-05/05.6
namespace ShramSafal.Domain.Privacy;

// Deviation from OQ-1 verdict — see DpaRecord.cs sibling for full reasoning.
// (Short version: AgriSync.* prefix collides with name resolution in
// AgriSync.Bootstrapper; Phase 05.2 set the precedent of staying on the
// existing ShramSafal.* root.)

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.6 — one row per outbound
/// call to a non-India processor. Mapped to
/// <c>ssf.cross_border_transfers</c>; consumed by Phase 08 export +
/// the DPDP §16 audit.
///
/// <para>
/// <b>Write path.</b>
/// <c>GeminiAiProvider</c> (the only consumer in 05.6) inserts via
/// <see cref="AgriSync.BuildingBlocks.Persistence.IAdminDbContextFactory{TContext}"/>
/// scoped to <c>SystemActor.CrossBorderLoggerUserId</c>. The admin
/// factory bypasses RLS (the table is exempt per OQ-5 — admin-only
/// read path in Phase 08, system-only write path here). Future
/// processors (Sarvam when chat fallback goes prod, Tomorrow.io if it
/// activates) write through the same factory pattern.
/// </para>
///
/// <para>
/// <b>Foreign-key-free.</b> The table cross-references aggregates
/// (<see cref="SourceAiJobId"/>, <see cref="FarmId"/>) but does not
/// declare FKs — the log MUST survive aggregate deletion so DPDP
/// audits remain reconstructible after an erasure request. The
/// <c>?</c> on both Ids encodes the missing-context branch (e.g.
/// CoVe-reverify on a transcript with no AI job).
/// </para>
///
/// <para>
/// <b>Append-only.</b> The migration grants <c>SELECT, INSERT</c>
/// only — no <c>UPDATE</c>, no <c>DELETE</c>. Domain factory keeps
/// properties private-set so application code cannot mutate either.
/// </para>
/// </summary>
public sealed class CrossBorderTransfer
{
    public Guid Id { get; private set; }

    /// <summary>
    /// UTC timestamp the outbound call resolved at. Stamped by
    /// <see cref="Create"/>; immutable.
    /// </summary>
    public DateTime OccurredAtUtc { get; private set; }

    /// <summary>
    /// AWS / cloud region the data was sent to (e.g.
    /// <c>"us-central1"</c> for Gemini). Indexed alongside
    /// <see cref="OccurredAtUtc"/> for the daily Phase-08 aggregate.
    /// </summary>
    public string DestinationRegion { get; private set; } = string.Empty;

    /// <summary>
    /// Vendor name (matches a <c>DpaRecord.VendorName</c>, e.g.
    /// <c>"Google_Gemini"</c>).
    /// </summary>
    public string DestinationVendor { get; private set; } = string.Empty;

    /// <summary>
    /// Short classification of what was sent (e.g.
    /// <c>"voice_transcript"</c>, <c>"image_ocr"</c>). Used by the
    /// Phase-08 export to bucket the audit summary.
    /// </summary>
    public string PayloadClass { get; private set; } = string.Empty;

    /// <summary>
    /// The <c>AiJob.Id</c> the call belongs to, when the call site has
    /// one in context. <c>null</c> for paths that do not (e.g. CoVe
    /// reverify on a free-standing transcript).
    /// </summary>
    public Guid? SourceAiJobId { get; private set; }

    /// <summary>
    /// The owning farm when known. <c>null</c> for admin-elevated
    /// paths and CoVe reverify where the orchestrator does not pass a
    /// farm in.
    /// </summary>
    public Guid? FarmId { get; private set; }

    /// <summary>
    /// Key identifier of the user-consent token authorising the
    /// transfer. Populated by Phase 06 (consent flow); <c>null</c>
    /// today. Kept on the row so the historical log remains
    /// reconstructible once consent shipping starts.
    /// </summary>
    public string? ConsentTokenKid { get; private set; }

    /// <summary>
    /// Approximate payload size in bytes (long for the streamed
    /// receipt/patti images that can exceed 2 GB on aggregate). Used
    /// only for cost/audit reporting — not enforced as a quota here.
    /// </summary>
    public long PayloadSizeBytes { get; private set; }

    private CrossBorderTransfer()
    {
        // EF Core materialisation; do not call.
    }

    /// <summary>
    /// Build a new <see cref="CrossBorderTransfer"/> for the current
    /// instant. <see cref="OccurredAtUtc"/> is stamped from
    /// <see cref="DateTime.UtcNow"/> at call time — the caller does
    /// not supply it so an accidental skewed write cannot rewrite
    /// history.
    /// </summary>
    public static CrossBorderTransfer Create(
        string region,
        string vendor,
        string payloadClass,
        Guid? sourceAiJobId,
        Guid? farmId,
        string? consentKid,
        long size)
    {
        if (string.IsNullOrWhiteSpace(region))
        {
            throw new ArgumentException("Region required.", nameof(region));
        }

        if (string.IsNullOrWhiteSpace(vendor))
        {
            throw new ArgumentException("Vendor required.", nameof(vendor));
        }

        if (string.IsNullOrWhiteSpace(payloadClass))
        {
            throw new ArgumentException("Payload class required.", nameof(payloadClass));
        }

        if (size < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(size), size, "Size must be non-negative.");
        }

        return new CrossBorderTransfer
        {
            Id = Guid.NewGuid(),
            OccurredAtUtc = DateTime.UtcNow,
            DestinationRegion = region.Trim(),
            DestinationVendor = vendor.Trim(),
            PayloadClass = payloadClass.Trim(),
            SourceAiJobId = sourceAiJobId,
            FarmId = farmId,
            ConsentTokenKid = string.IsNullOrWhiteSpace(consentKid) ? null : consentKid.Trim(),
            PayloadSizeBytes = size,
        };
    }
}
