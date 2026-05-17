// spec: data-principle-spine-2026-05-05/05.5
namespace ShramSafal.Domain.Privacy;

// Deviation from OQ-1 verdict (which mandated AgriSync.ShramSafal.Domain.Privacy):
// the AgriSync.* prefix collides with name resolution inside
// AgriSync.Bootstrapper where existing files reference ShramSafal.Api as a
// root-namespace fragment — the compiler picks the AgriSync.ShramSafal
// ancestor first and fails to resolve .Api. Phase 05.2 (commit 85a11c3)
// hit the same problem and quietly landed at ShramSafal.Application.UseCases.
// Privacy instead of AgriSync.ShramSafal.Application.UseCases.Privacy;
// we follow that established precedent. The namespace is reachable on
// the same path under the OQ-1-specified folder layout —
// src/apps/ShramSafal/ShramSafal.Domain/Privacy/.

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.5 — registry row tracking
/// the DPDP §8(2) Data Processing Agreement with one third-party
/// processor (AWS, Google/Gemini, Sarvam, …). The table is queried at
/// startup: any row with <see cref="IsActive"/> = <c>false</c> surfaces
/// a <c>LogWarning("DPA pending for: …")</c> in <c>Program.cs</c> so an
/// unsigned DPA cannot silently slip into production.
///
/// <para>
/// <b>Pending rows per OQ-4 verdict.</b> The seed ships three vendor
/// rows with <c>contract_path="PENDING_LEGAL_UPLOAD"</c>,
/// <see cref="SignedDate"/> = <c>null</c>, <see cref="IsActive"/> =
/// <c>false</c>. The earlier plan-body sketch used
/// <c>DateOnly.Parse("1900-01-01")</c> as a sentinel; the conflict-
/// resolver rejected the hack in favour of nullable
/// <see cref="DateOnly"/> so a NULL-as-pending semantic survives the
/// trip through EF, JSON, and the startup query untouched.
/// </para>
///
/// <para>
/// <b>Domain only.</b> No EF imports here — the persistence shape lives
/// on <c>ssf.dpa_registry</c> via
/// <c>DpaRecordConfiguration</c> in the Infrastructure project.
/// </para>
/// </summary>
public sealed class DpaRecord
{
    public Guid Id { get; private set; }

    /// <summary>
    /// Vendor identifier. Free-form short string (e.g. <c>"AWS"</c>,
    /// <c>"Google_Gemini"</c>, <c>"Sarvam"</c>). Max 128 chars per
    /// <c>DpaRecordConfiguration</c>.
    /// </summary>
    public string VendorName { get; private set; } = string.Empty;

    /// <summary>
    /// Path to the signed contract artefact, or the sentinel
    /// <c>"PENDING_LEGAL_UPLOAD"</c> per OQ-4 for rows that have no
    /// PDF yet. Max 512 chars.
    /// </summary>
    public string ContractPath { get; private set; } = string.Empty;

    /// <summary>
    /// Date the DPA was signed by both parties. <c>null</c> for rows
    /// awaiting legal sign-off — the startup warning targets these.
    /// </summary>
    public DateOnly? SignedDate { get; private set; }

    /// <summary>
    /// Brief description of the data the processor receives (e.g.
    /// <c>"Voice transcript parsing"</c>). Max 256 chars.
    /// </summary>
    public string Scope { get; private set; } = string.Empty;

    /// <summary>
    /// AWS region the processor stores data in (e.g. <c>"ap-south-1"</c>,
    /// <c>"us-central1"</c>). Reads cross-reference into the
    /// <c>cross_border_transfers</c> log when the value is anything
    /// other than <see cref="RegionGuard.RequiredRegion"/>. Max 32 chars.
    /// </summary>
    public string Region { get; private set; } = string.Empty;

    /// <summary>
    /// Privacy-team contact at the processor. Max 128 chars.
    /// </summary>
    public string ContactEmail { get; private set; } = string.Empty;

    /// <summary>
    /// <c>true</c> when a counter-signed DPA is on file and the
    /// processor is cleared for production use. <c>false</c> for
    /// pending rows; the startup warning lists every <c>false</c>
    /// vendor as a DPDP §8(2) compliance gap.
    /// </summary>
    public bool IsActive { get; private set; }

    private DpaRecord()
    {
        // EF Core materialisation; do not call.
    }

    /// <summary>
    /// Factory for new rows. Use <see cref="CreatePending"/> for the
    /// seed pattern (no signed date, inactive).
    /// </summary>
    public static DpaRecord Create(
        string vendorName,
        string contractPath,
        DateOnly? signedDate,
        string scope,
        string region,
        string contactEmail,
        bool isActive)
    {
        if (string.IsNullOrWhiteSpace(vendorName))
        {
            throw new ArgumentException("Vendor name required.", nameof(vendorName));
        }

        if (string.IsNullOrWhiteSpace(contractPath))
        {
            throw new ArgumentException("Contract path required (use 'PENDING_LEGAL_UPLOAD' for unsigned rows).", nameof(contractPath));
        }

        if (string.IsNullOrWhiteSpace(scope))
        {
            throw new ArgumentException("Scope required.", nameof(scope));
        }

        if (string.IsNullOrWhiteSpace(region))
        {
            throw new ArgumentException("Region required.", nameof(region));
        }

        if (string.IsNullOrWhiteSpace(contactEmail))
        {
            throw new ArgumentException("Contact email required.", nameof(contactEmail));
        }

        return new DpaRecord
        {
            Id = Guid.NewGuid(),
            VendorName = vendorName.Trim(),
            ContractPath = contractPath.Trim(),
            SignedDate = signedDate,
            Scope = scope.Trim(),
            Region = region.Trim(),
            ContactEmail = contactEmail.Trim(),
            IsActive = isActive,
        };
    }
}
