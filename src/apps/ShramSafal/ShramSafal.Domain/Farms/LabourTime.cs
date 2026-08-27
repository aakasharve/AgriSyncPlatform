namespace ShramSafal.Domain.Farms;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 4) — how
/// many hours a labour engagement lasted, and whether the farmer SAID so or the
/// server ASSUMED it. <c>DurationHours</c> alone is a lie; <c>DurationHours</c> +
/// <c>TimeBasis</c> is a record.
///
/// <para><b>Unspecified = 0 is deliberate.</b> A <c>readonly record struct</c>
/// always carries an implicit public parameterless constructor, so
/// <c>default(LabourTime)</c> is reachable no matter how the named constructors
/// are locked down. Giving the zero enum value its own name — instead of letting
/// it silently collapse onto <see cref="LabourTimeBasis.Assumed"/> — makes that
/// unreachable-by-convention state DETECTABLE. <see cref="LabourAssignment.Create"/>
/// is what actually closes the hole, by throwing whenever it sees
/// <see cref="LabourTimeBasis.Unspecified"/> or a non-positive hour count.</para>
/// </summary>
public enum LabourTimeBasis
{
    Unspecified = 0,
    Assumed = 1,
    Explicit = 2,
}

/// <summary>
/// A duration with its provenance attached — see the type-level remarks on
/// <see cref="LabourTimeBasis"/> for why the pairing, not just the number, is
/// the load-bearing fact.
/// </summary>
public readonly record struct LabourTime
{
    /// <summary>The ONE server default — 8 hours, used only when the farmer never stated a duration.</summary>
    public const decimal ServerDefaultHours = 8m;

    public decimal Hours { get; }
    public LabourTimeBasis Basis { get; }

    private LabourTime(decimal hours, LabourTimeBasis basis)
    {
        Hours = hours;
        Basis = basis;
    }

    /// <summary>The farmer stated this duration directly.</summary>
    public static LabourTime Explicit(decimal hours)
    {
        if (hours <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(hours), hours, "Duration hours must be positive.");
        }

        return new LabourTime(hours, LabourTimeBasis.Explicit);
    }

    /// <summary>The server filled this duration in — nobody stated it.</summary>
    public static LabourTime Assumed(decimal hours)
    {
        if (hours <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(hours), hours, "Duration hours must be positive.");
        }

        return new LabourTime(hours, LabourTimeBasis.Assumed);
    }

    /// <summary>The voice/AI derivation path's only duration — the model emits no duration key (A5).</summary>
    public static LabourTime ServerAssumed() => Assumed(ServerDefaultHours);
}
