namespace ShramSafal.Domain.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.4 — admin-managed feature flag
/// row (Safeguard S7). Flags are global (no farm dimension) and backed
/// by a unique <see cref="FlagName"/>. Cohort gating (e.g. "founder",
/// "founder|pilot-5", "all") is expressed via the optional
/// <see cref="CohortPattern"/>; consumers interpret the pattern.
/// </summary>
/// <remarks>
/// Mutators (<see cref="Enable"/> / <see cref="Disable"/> /
/// <see cref="UpdateCohortPattern"/>) require a <c>modifiedBy</c>
/// identifier so admin audits stay attached to every state change.
/// </remarks>
public sealed class FeatureFlag
{
    private FeatureFlag() { } // EF Core

    private FeatureFlag(
        Guid id,
        string flagName,
        bool enabled,
        string? cohortPattern,
        string? description,
        DateTime modifiedAtUtc,
        string? modifiedBy)
    {
        Id = id;
        FlagName = flagName;
        Enabled = enabled;
        CohortPattern = cohortPattern;
        Description = description;
        ModifiedAtUtc = modifiedAtUtc;
        ModifiedBy = modifiedBy;
    }

    public Guid Id { get; private set; }

    /// <summary>
    /// Unique flag identifier (e.g.
    /// <c>voice_provider_sarvam_cohort</c>). Read by the runtime to
    /// decide gating; admins flip the row via the
    /// <c>/shramsafal/admin/feature-flags</c> surface.
    /// </summary>
    public string FlagName { get; private set; } = string.Empty;

    public bool Enabled { get; private set; }

    /// <summary>
    /// Optional cohort selector (e.g. <c>founder</c>, <c>pilot-5</c>,
    /// <c>all</c>). Null means the flag's <see cref="Enabled"/> bit is
    /// the sole gate.
    /// </summary>
    public string? CohortPattern { get; private set; }

    public string? Description { get; private set; }

    public DateTime ModifiedAtUtc { get; private set; }

    /// <summary>
    /// Identifier of the last actor that mutated the flag (admin user
    /// id, system service name, <c>system-seed</c>). Stored as a
    /// free-form string for forward compatibility.
    /// </summary>
    public string? ModifiedBy { get; private set; }

    /// <summary>
    /// Factory. Validates the flag name is non-empty; trims optional
    /// fields and stores null for whitespace-only inputs. Generates a
    /// new <see cref="Guid"/> when <paramref name="id"/> is
    /// <see cref="Guid.Empty"/>.
    /// </summary>
    public static FeatureFlag Create(
        Guid id,
        string flagName,
        bool enabled,
        string? cohortPattern,
        string? description,
        DateTime modifiedAtUtc,
        string? modifiedBy)
    {
        if (string.IsNullOrWhiteSpace(flagName))
        {
            throw new ArgumentException("flagName is required.", nameof(flagName));
        }

        return new FeatureFlag(
            id: id == Guid.Empty ? Guid.NewGuid() : id,
            flagName: flagName.Trim(),
            enabled: enabled,
            cohortPattern: string.IsNullOrWhiteSpace(cohortPattern) ? null : cohortPattern.Trim(),
            description: string.IsNullOrWhiteSpace(description) ? null : description.Trim(),
            modifiedAtUtc: modifiedAtUtc,
            modifiedBy: string.IsNullOrWhiteSpace(modifiedBy) ? null : modifiedBy.Trim());
    }

    public void Enable(string? modifiedBy)
    {
        Enabled = true;
        ModifiedAtUtc = DateTime.UtcNow;
        ModifiedBy = string.IsNullOrWhiteSpace(modifiedBy) ? null : modifiedBy.Trim();
    }

    public void Disable(string? modifiedBy)
    {
        Enabled = false;
        ModifiedAtUtc = DateTime.UtcNow;
        ModifiedBy = string.IsNullOrWhiteSpace(modifiedBy) ? null : modifiedBy.Trim();
    }

    /// <summary>
    /// Updates the cohort selector. Pass <c>null</c> or whitespace to
    /// clear the selector (flag falls back to its <see cref="Enabled"/>
    /// bit as the sole gate).
    /// </summary>
    public void UpdateCohortPattern(string? cohortPattern, string? modifiedBy)
    {
        CohortPattern = string.IsNullOrWhiteSpace(cohortPattern) ? null : cohortPattern.Trim();
        ModifiedAtUtc = DateTime.UtcNow;
        ModifiedBy = string.IsNullOrWhiteSpace(modifiedBy) ? null : modifiedBy.Trim();
    }
}
