namespace ShramSafal.Domain.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.5 — data-driven policy that maps
/// a trigger (e.g. <c>normal_daily_log</c>, <c>verbatim_sample</c>,
/// <c>dispute_flagged</c>, <c>low_confidence</c>) to the comma-separated
/// list of Sarvam STT modes that should run for that trigger, plus an
/// optional daily INR cost cap and a priority for tie-breaks. Per
/// ADR-DS-016 the table is the single source of truth for "which mode
/// for which trigger"; the worker reads it on each evaluation.
/// </summary>
/// <remarks>
/// <para>
/// <b>Critical (founder blocker #4).</b> Diarization is NOT a Sarvam STT
/// mode. <see cref="ModesToRun"/> must only contain the five valid
/// Sarvam modes (<c>codemix</c> | <c>verbatim</c> | <c>translit</c> |
/// <c>translate</c> | <c>transcribe</c>). Diarization-as-capability is
/// modeled separately in <see cref="DiarizationPolicy"/>.
/// </para>
/// <para>
/// <see cref="Priority"/> is the tie-break order when two rows match
/// the same trigger; lower wins. <see cref="MaxDailyCostInr"/> is the
/// cost cap the worker enforces before invoking the mode list (null =
/// no cap). <see cref="AppliesToEventType"/> narrows the policy to a
/// specific event class (e.g. <c>spray</c>, <c>harvest</c>); null
/// applies the row to every event.
/// </para>
/// </remarks>
public sealed class ModePolicy
{
    private ModePolicy() { } // EF Core

    private ModePolicy(
        Guid id,
        string triggerType,
        string modesToRun,
        int priority,
        decimal? maxDailyCostInr,
        string? appliesToEventType,
        bool enabled,
        DateTime createdAtUtc)
    {
        Id = id;
        TriggerType = triggerType;
        ModesToRun = modesToRun;
        Priority = priority;
        MaxDailyCostInr = maxDailyCostInr;
        AppliesToEventType = appliesToEventType;
        Enabled = enabled;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
    }

    public Guid Id { get; private set; }

    /// <summary>
    /// The trigger that selects this row (e.g. <c>normal_daily_log</c>,
    /// <c>verbatim_sample</c>, <c>dispute_flagged</c>,
    /// <c>low_confidence</c>). Multiple rows MAY share a trigger; the
    /// worker resolves ties via <see cref="Priority"/>.
    /// </summary>
    public string TriggerType { get; private set; } = string.Empty;

    /// <summary>
    /// Comma-separated list of Sarvam STT modes
    /// (<c>codemix</c> | <c>verbatim</c> | <c>translit</c> |
    /// <c>translate</c> | <c>transcribe</c>) to run when the trigger
    /// fires. NEVER includes <c>diarized</c> or <c>diarization</c> —
    /// see remarks on the type.
    /// </summary>
    public string ModesToRun { get; private set; } = string.Empty;

    public int Priority { get; private set; }
    public decimal? MaxDailyCostInr { get; private set; }
    public string? AppliesToEventType { get; private set; }
    public bool Enabled { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    /// <summary>
    /// Factory. Validates <paramref name="triggerType"/> and
    /// <paramref name="modesToRun"/> are non-empty. Trims nullable
    /// fields and stores null when blank. Generates a new
    /// <see cref="Guid"/> when <paramref name="id"/> is
    /// <see cref="Guid.Empty"/>. Stamps both timestamps to
    /// <paramref name="createdAtUtc"/>.
    /// </summary>
    public static ModePolicy Create(
        Guid id,
        string triggerType,
        string modesToRun,
        int priority,
        decimal? maxDailyCostInr,
        string? appliesToEventType,
        bool enabled,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(triggerType))
        {
            throw new ArgumentException("triggerType is required.", nameof(triggerType));
        }

        if (string.IsNullOrWhiteSpace(modesToRun))
        {
            throw new ArgumentException("modesToRun is required.", nameof(modesToRun));
        }

        return new ModePolicy(
            id: id == Guid.Empty ? Guid.NewGuid() : id,
            triggerType: triggerType.Trim(),
            modesToRun: modesToRun.Trim(),
            priority: priority,
            maxDailyCostInr: maxDailyCostInr,
            appliesToEventType: string.IsNullOrWhiteSpace(appliesToEventType) ? null : appliesToEventType.Trim(),
            enabled: enabled,
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

    public void UpdateModes(string modesToRun)
    {
        if (string.IsNullOrWhiteSpace(modesToRun))
        {
            throw new ArgumentException("modesToRun is required.", nameof(modesToRun));
        }

        ModesToRun = modesToRun.Trim();
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
