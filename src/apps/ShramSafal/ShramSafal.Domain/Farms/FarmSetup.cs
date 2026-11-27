namespace ShramSafal.Domain.Farms;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9; founder 27 Nov: "send it to server; the phone is only a door; this is the infrastructure")
//
// A farm's SETUP on the server, per farm: water sources with their motors, the power timetable, machines, and how each plot gets its water.
// The words every part shares live here: the state of a row, the reason a change is refused, and the lists of values the wire may carry.

/// <summary>Whether a setup row is part of the farm's setup now. A removal is a state: the row is never deleted (the application role holds no DELETE).</summary>
public enum FarmSetupState
{
    Active = 0,
    Removed = 1,
}

/// <summary>Why a setup change does not hold together: a short rule name and plain words. Nothing is saved when one is returned.</summary>
public sealed record FarmSetupProblem(string Code, string Message);

/// <summary>
/// The values the wire may carry, lower-case words exactly as the sync contract lists them. A value outside its list is REFUSED by name; it is never
/// mapped to "other" or to a default (a guessed type would be a fact nobody stated).
/// </summary>
public static class FarmSetupValues
{
    public const int MaxNameLength = 80;
    public const int MaxNotesLength = 300;
    public const int MaxMotorsPerSource = 12;
    public const int MaxLinksPerPlot = 24;

    public static readonly IReadOnlyList<string> WaterSourceTypes = ["well", "borewell", "canal", "farm_pond", "tanker"];
    public static readonly IReadOnlyList<string> PowerSources = ["mseb", "solar", "generator"];
    public static readonly IReadOnlyList<string> MachineTypes = ["tractor", "blower", "sprayer", "rotavator", "harvester", "other"];
    public static readonly IReadOnlyList<string> Ownerships = ["owned", "rented"];
    public static readonly IReadOnlyList<string> IrrigationMethods = ["drip", "flood", "sprinkler", "none"];

    /// <summary>The "no water facility" answer ("पाण्याची सोय नाही"): a stated fact, never the same as a plot that was not asked.</summary>
    public const string NoWaterMethod = "none";

    internal static bool IsOneOf(IReadOnlyList<string> allowed, string? value) => value is not null && allowed.Contains(value, StringComparer.Ordinal);

    /// <summary>Trimmed text, or null when nothing was written (an optional detail that is not known stays unknown).</summary>
    internal static string? Optional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>A stated quantity is kept exactly as stated: one with more decimals than the column holds is refused rather than rounded.</summary>
    internal static bool HasAtMostTwoDecimals(decimal value) => decimal.Round(value, 2) == value;
}
