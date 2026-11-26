using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Farms;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9)

/// <summary>
/// A farm's power timetable ("वीज कधी असते?") after it was read STRICTLY: both phases, each with its pattern and its off-windows. The values keep the
/// phone's own codes. A key the format does not know, a time that is not HH:mm, a day that is not Mon..Sun, an unknown pattern or repeat rule, or more
/// than twelve windows in one week of one phase is refused by name (<see cref="TryParse"/>); nothing is guessed or dropped.
/// <para>One canonical text (<see cref="CanonicalJson"/>: fixed key order, no white space, <c>weekBOffWindows</c> always written, empty when none was
/// sent) and its SHA-256 (<see cref="ContentHash"/>), so "the same timetable again" is one comparison.</para>
/// </summary>
public sealed partial class PowerTimetable
{
    public const int MaxWindowsPerWeek = 12;

    private static readonly string[] PatternModes = ["FIXED_WEEKLY", "CUSTOM_DAILY", "ROTATIONAL"];
    private static readonly string[] RepeatRules = ["DAILY", "WEEKLY", "ALTERNATE_WEEK"];
    private static readonly string[] Days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    private static readonly string[] PhaseKeys = ["patternMode", "alternateWeeklyPattern", "weekAOffWindows", "weekBOffWindows"];
    private static readonly string[] WindowKeys = ["id", "startTime", "endTime", "repeatRule", "days"];

    private PowerTimetable(string canonicalJson)
    {
        CanonicalJson = canonicalJson;
        ContentHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalJson))).ToLowerInvariant();
    }

    public string CanonicalJson { get; }

    /// <summary>64 lower-case hex characters: the SHA-256 of <see cref="CanonicalJson"/>.</summary>
    public string ContentHash { get; }

    [GeneratedRegex("^([01][0-9]|2[0-3]):[0-5][0-9]\\z")]
    private static partial Regex ClockTime();

    public static bool TryParse(string? json, out PowerTimetable? timetable, out FarmSetupProblem? problem)
    {
        timetable = null;
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(json ?? string.Empty);
        }
        catch (JsonException)
        {
            problem = new("PowerTimesShape", "The power timetable is one object with the single-phase and the three-phase timings.");
            return false;
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                problem = new("PowerTimesShape", "The power timetable is one object with the single-phase and the three-phase timings.");
                return false;
            }

            if (UnknownKey(root, ["singlePhase", "threePhase"]) is { } unknown)
            {
                problem = new("PowerTimesUnknownKey", $"The power timetable does not have a part called '{unknown}'.");
                return false;
            }

            using var buffer = new MemoryStream();
            using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
            {
                writer.WriteStartObject();
                foreach (var phase in new[] { "singlePhase", "threePhase" })
                {
                    if (!root.TryGetProperty(phase, out var value) || value.ValueKind != JsonValueKind.Object)
                    {
                        problem = new("PowerTimesPhase", "The power timetable carries both the single-phase and the three-phase timings.");
                        return false;
                    }

                    writer.WritePropertyName(phase);
                    if (WritePhase(writer, value) is { } bad)
                    {
                        problem = bad;
                        return false;
                    }
                }

                writer.WriteEndObject();
            }

            problem = null;
            timetable = new PowerTimetable(Encoding.UTF8.GetString(buffer.ToArray()));
            return true;
        }
    }

    private static FarmSetupProblem? WritePhase(Utf8JsonWriter writer, JsonElement phase)
    {
        if (UnknownKey(phase, PhaseKeys) is { } unknown)
        {
            return new("PowerTimesUnknownKey", $"A phase of the power timetable does not have a part called '{unknown}'.");
        }

        if (!phase.TryGetProperty("patternMode", out var mode) || mode.ValueKind != JsonValueKind.String || !PatternModes.Contains(mode.GetString(), StringComparer.Ordinal))
        {
            return new("PowerTimesPattern", "A phase's pattern is FIXED_WEEKLY, CUSTOM_DAILY or ROTATIONAL.");
        }

        if (!phase.TryGetProperty("alternateWeeklyPattern", out var alternate) || alternate.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            return new("PowerTimesPattern", "A phase says whether its weeks alternate (true or false).");
        }

        writer.WriteStartObject();
        writer.WriteString("patternMode", mode.GetString());
        writer.WriteBoolean("alternateWeeklyPattern", alternate.GetBoolean());
        foreach (var week in new[] { "weekAOffWindows", "weekBOffWindows" })
        {
            var present = phase.TryGetProperty(week, out var windows);
            if (!present && week == "weekAOffWindows" || present && windows.ValueKind != JsonValueKind.Array)
            {
                return new("PowerTimesWindow", "A phase lists its off-windows (the list may be empty).");
            }

            writer.WriteStartArray(week);
            if (present)
            {
                if (windows.GetArrayLength() > MaxWindowsPerWeek)
                {
                    return new("PowerTimesWindowCount", $"One week of one phase has at most {MaxWindowsPerWeek} off-windows.");
                }

                foreach (var window in windows.EnumerateArray())
                {
                    if (WriteWindow(writer, window) is { } bad)
                    {
                        return bad;
                    }
                }
            }

            writer.WriteEndArray();
        }

        writer.WriteEndObject();
        return null;
    }

    private static FarmSetupProblem? WriteWindow(Utf8JsonWriter writer, JsonElement window)
    {
        if (window.ValueKind != JsonValueKind.Object)
        {
            return new("PowerTimesWindow", "An off-window has an id, a start time, an end time, a repeat rule and its days.");
        }

        if (UnknownKey(window, WindowKeys) is { } unknown)
        {
            return new("PowerTimesUnknownKey", $"An off-window does not have a part called '{unknown}'.");
        }

        if (!window.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(id.GetString()) || id.GetString()!.Length > 64)
        {
            return new("PowerTimesWindow", "An off-window has an id of 1 to 64 characters.");
        }

        foreach (var key in new[] { "startTime", "endTime" })
        {
            if (!window.TryGetProperty(key, out var time) || time.ValueKind != JsonValueKind.String || !ClockTime().IsMatch(time.GetString()!))
            {
                return new("PowerTimesTime", "An off-window's start and end are times of day written HH:mm (00:00 to 23:59).");
            }
        }

        if (!window.TryGetProperty("repeatRule", out var rule) || rule.ValueKind != JsonValueKind.String || !RepeatRules.Contains(rule.GetString(), StringComparer.Ordinal))
        {
            return new("PowerTimesRepeatRule", "An off-window repeats DAILY, WEEKLY or ALTERNATE_WEEK.");
        }

        if (!window.TryGetProperty("days", out var days) || days.ValueKind != JsonValueKind.Array || days.GetArrayLength() > 7
            || days.EnumerateArray().Any(d => d.ValueKind != JsonValueKind.String || !Days.Contains(d.GetString(), StringComparer.Ordinal)))
        {
            return new("PowerTimesDay", "An off-window's days are Mon, Tue, Wed, Thu, Fri, Sat or Sun (at most seven).");
        }

        writer.WriteStartObject();
        writer.WriteString("id", id.GetString());
        writer.WriteString("startTime", window.GetProperty("startTime").GetString());
        writer.WriteString("endTime", window.GetProperty("endTime").GetString());
        writer.WriteString("repeatRule", rule.GetString());
        writer.WriteStartArray("days");
        foreach (var day in days.EnumerateArray())
        {
            writer.WriteStringValue(day.GetString());
        }

        writer.WriteEndArray();
        writer.WriteEndObject();
        return null;
    }

    private static string? UnknownKey(JsonElement element, string[] known) =>
        element.EnumerateObject().Select(p => p.Name).FirstOrDefault(name => !known.Contains(name, StringComparer.Ordinal));
}

/// <summary>
/// The power timetable of ONE farm (<c>ssf.farm_power_times</c>): one row per farm, one document, because the screen edits and saves it whole. Its id IS
/// the farm's id. <see cref="Revision"/> goes up once per real change and is the row's concurrency token.
/// </summary>
public sealed class FarmPowerTimes : Entity<Guid>
{
    private FarmPowerTimes() : base(Guid.Empty) { } // EF Core

    private FarmPowerTimes(Guid farmId, PowerTimetable timetable, UserId byUserId, DateTime atUtc)
        : base(farmId)
    {
        Content = timetable.CanonicalJson;
        ContentHash = timetable.ContentHash;
        Revision = 1;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
    }

    /// <summary>The farm this timetable belongs to (the row's key).</summary>
    public FarmId FarmId => new(Id);

    /// <summary>The timetable as JSON. The database keeps it as jsonb (its own key order); read it back through <see cref="PowerTimetable.TryParse"/>.</summary>
    public string Content { get; private set; } = string.Empty;

    public string ContentHash { get; private set; } = string.Empty;
    public int Revision { get; private set; }
    public UserId UpdatedByUserId { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    public static FarmPowerTimes Create(FarmId farmId, PowerTimetable timetable, UserId byUserId, DateTime atUtc)
    {
        ArgumentNullException.ThrowIfNull(timetable);
        if (farmId.IsEmpty || byUserId.IsEmpty)
        {
            throw new ArgumentException("A power timetable names its farm and who saved it.");
        }

        return new FarmPowerTimes(farmId.Value, timetable, byUserId, atUtc);
    }

    /// <summary>True when the farm already holds exactly this timetable.</summary>
    public bool Matches(PowerTimetable timetable) => timetable is not null && timetable.ContentHash == ContentHash;

    /// <summary>Replaces the timetable whole. Returns false, and changes nothing, when it is the same timetable.</summary>
    public bool Change(PowerTimetable timetable, UserId byUserId, DateTime atUtc)
    {
        ArgumentNullException.ThrowIfNull(timetable);
        if (byUserId.IsEmpty)
        {
            throw new ArgumentException("A change names who made it.", nameof(byUserId));
        }

        if (Matches(timetable))
        {
            return false;
        }

        Content = timetable.CanonicalJson;
        ContentHash = timetable.ContentHash;
        Revision++;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
        return true;
    }
}
