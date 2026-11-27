namespace ShramSafal.Domain.Farms;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, contract §2.2 / §3.2; founder 27 Nov "kinds of work he may record", CTO ruling
/// Q2) — the kinds of work the farm's registrant may limit one person to recording. They ARE the record's own bucket names (one vocabulary with the
/// record, never a second list): <c>sync-contract/schemas/work-kinds.json</c> is the one file, pinned to this class by
/// <c>WorkKindsTests</c>. Six can be limited (पीक काम, पाणी, औषध / खत, मजूर, यंत्र, खर्च); an observation and a reminder are always open (an
/// observation is not work, a reminder is his own; planned work for others is governed by "काम सांगणे"). फवारणी and खत share one kind
/// (<see cref="Inputs"/>): the record cannot tell them apart without guessing (Q2).
/// <para><b>Stored as a set or as nothing:</b> <c>null</c> = every kind (every seat until the owner limits it, P9 / P11); a set holding all six is
/// stored as <c>null</c>, so a kind added later is never silently closed; an empty set is refused (stopping someone is "काम थांबवा").</para>
/// </summary>
public static class WorkKinds
{
    public const string CropActivities = "cropActivities";
    public const string Irrigation = "irrigation";
    public const string Inputs = "inputs";
    public const string Labour = "labour";
    public const string Machinery = "machinery";
    public const string ActivityExpenses = "activityExpenses";

    public const string Observations = "observations";
    public const string PlannedTasks = "plannedTasks";

    /// <summary>The six kinds that can be limited, in the contract's order (the order a stored set keeps).</summary>
    public static readonly IReadOnlyList<string> All = [CropActivities, Irrigation, Inputs, Labour, Machinery, ActivityExpenses];

    /// <summary>The two kinds that are never limited.</summary>
    public static readonly IReadOnlyList<string> AlwaysOpen = [Observations, PlannedTasks];

    private static readonly HashSet<string> Limitable = new(All, StringComparer.Ordinal);

    /// <summary>Is <paramref name="kind"/> one of the six that can be limited (exact name)?</summary>
    public static bool IsLimitable(string? kind) => kind is not null && Limitable.Contains(kind);

    /// <summary>
    /// The set a desired list stores: <c>null</c> when it names all six, otherwise its names in the contract's order. Refused (never trimmed):
    /// an empty list, an unknown or always-open name, a name twice.
    /// </summary>
    public static IReadOnlyList<string>? Normalize(IReadOnlyCollection<string> desired)
    {
        ArgumentNullException.ThrowIfNull(desired);
        if (desired.Count == 0)
        {
            throw new ArgumentException("A limit names at least one kind of work; stopping someone's work is a pause.", nameof(desired));
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var kind in desired)
        {
            if (!IsLimitable(kind))
            {
                throw new ArgumentException($"'{kind}' is not a kind of work that can be limited.", nameof(desired));
            }

            if (!seen.Add(kind))
            {
                throw new ArgumentException($"'{kind}' is named twice.", nameof(desired));
            }
        }

        return seen.Count == All.Count ? null : All.Where(seen.Contains).ToList();
    }

    /// <summary>May a seat holding <paramref name="allowed"/> (<c>null</c> = every kind) record <paramref name="kind"/>? The always-open kinds always.</summary>
    public static bool Allows(IReadOnlyCollection<string>? allowed, string kind) =>
        allowed is null || !IsLimitable(kind) || allowed.Contains(kind);

    /// <summary>The kinds of <paramref name="kinds"/> a seat holding <paramref name="allowed"/> may NOT record, in the contract's order.</summary>
    public static IReadOnlyList<string> Closed(IReadOnlyCollection<string>? allowed, IEnumerable<string> kinds)
    {
        ArgumentNullException.ThrowIfNull(kinds);
        if (allowed is null)
        {
            return [];
        }

        var asked = kinds.ToHashSet(StringComparer.Ordinal);
        return All.Where(k => asked.Contains(k) && !allowed.Contains(k)).ToList();
    }
}
