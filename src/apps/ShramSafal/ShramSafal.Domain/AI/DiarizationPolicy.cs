namespace ShramSafal.Domain.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.5a — data-driven policy that
/// gates Sarvam diarization-as-capability per trigger. Per founder
/// blocker #4, diarization is a SEPARATE provider capability (not a
/// Sarvam STT mode) and lives in its own table so the dimension is
/// modeled honestly.
/// </summary>
/// <remarks>
/// <para>
/// One row per <see cref="TriggerType"/> (unique). Each row tells the
/// worker whether to attach diarization for that trigger, with an
/// optional daily cost cap and event-type narrowing.
/// </para>
/// <para>
/// Diarization on Sarvam is an add-on capability per the pricing matrix
/// (list ₹15/hr add-on as of 2026-05-21); the worker enforces the cap
/// before requesting the capability.
/// </para>
/// </remarks>
public sealed class DiarizationPolicy
{
    private DiarizationPolicy() { } // EF Core

    private DiarizationPolicy(
        Guid id,
        string triggerType,
        bool enabled,
        decimal? maxDailyCostInr,
        string? appliesToEventType,
        DateTime createdAtUtc)
    {
        Id = id;
        TriggerType = triggerType;
        Enabled = enabled;
        MaxDailyCostInr = maxDailyCostInr;
        AppliesToEventType = appliesToEventType;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
    }

    public Guid Id { get; private set; }

    /// <summary>
    /// The trigger that selects this row (e.g.
    /// <c>dispute_flagged</c>, <c>high_risk_clip</c>,
    /// <c>founder_manual</c>). Unique across the table.
    /// </summary>
    public string TriggerType { get; private set; } = string.Empty;

    public bool Enabled { get; private set; }
    public decimal? MaxDailyCostInr { get; private set; }
    public string? AppliesToEventType { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    /// <summary>
    /// Factory. Validates <paramref name="triggerType"/> is non-empty.
    /// Trims optional fields and stores null when blank. Generates a
    /// new <see cref="Guid"/> when <paramref name="id"/> is
    /// <see cref="Guid.Empty"/>. Stamps both timestamps to
    /// <paramref name="createdAtUtc"/>.
    /// </summary>
    public static DiarizationPolicy Create(
        Guid id,
        string triggerType,
        bool enabled,
        decimal? maxDailyCostInr,
        string? appliesToEventType,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(triggerType))
        {
            throw new ArgumentException("triggerType is required.", nameof(triggerType));
        }

        return new DiarizationPolicy(
            id: id == Guid.Empty ? Guid.NewGuid() : id,
            triggerType: triggerType.Trim(),
            enabled: enabled,
            maxDailyCostInr: maxDailyCostInr,
            appliesToEventType: string.IsNullOrWhiteSpace(appliesToEventType) ? null : appliesToEventType.Trim(),
            createdAtUtc: createdAtUtc);
    }

    public void Enable()
    {
        Enabled = true;
        ModifiedAtUtc = DateTime.UtcNow;
    }

    public void Disable()
    {
        Enabled = false;
        ModifiedAtUtc = DateTime.UtcNow;
    }

    /// <summary>
    /// Updates the daily cost cap. Pass <c>null</c> to lift the cap.
    /// </summary>
    public void UpdateDailyCap(decimal? cap)
    {
        MaxDailyCostInr = cap;
        ModifiedAtUtc = DateTime.UtcNow;
    }
}
