// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S0) - the government village list (LGD) the server holds.
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace User.Infrastructure.Places;

/// <summary>How the list marks a village: lived in, not lived in, or forest. Stored as a smallint (1, 2, 3).</summary>
public enum LgdVillageStatus : short
{
    Inhabited = 1,
    Uninhabited = 2,
    Forest = 3,
}

/// <summary>One district: its LGD code, the list's English name and the Marathi name from the district sheet.</summary>
public sealed record LgdDistrictRow(int Code, string NameEn, string NameMr);

/// <summary>One taluka: its LGD code, its district's code and the list's English name. No Marathi name (founder question 8 is open).</summary>
public sealed record LgdTalukaRow(int Code, int DistrictCode, string NameEn);

/// <summary>One village: its LGD code (the join key), its taluka's code, the list's Marathi name (null for the 42 that have none), the list's
/// English name, its PIN (null for the 125 that have none) and its status.</summary>
public sealed record LgdVillageRow(int Code, int TalukaCode, string? NameMr, string NameEn, string? Pin, LgdVillageStatus Status);

/// <summary>
/// The government village list as the server embeds it (<c>Places/lgd-mh-2026-11-26.tsv</c> and <c>...-areas.json</c>, built by
/// <c>ops/places/build_place_list.py</c> from the founder's CSV). The TSV's first line names the version, the source, the provenance
/// ("Secondary source; not independently verified") and the counts it holds; <see cref="Parse"/> refuses a file whose rows do not match
/// those counts, a code seen twice, a village whose taluka is not listed, a PIN that is not six digits, or an unknown status.
/// It never fills a missing name: a village with no Marathi name keeps none, and no taluka carries a Marathi name.
/// </summary>
public sealed class LgdPlaceList
{
    /// <summary>The list version this server holds. The phone's bundled file carries the same string.</summary>
    public const string CurrentVersion = "lgd-mh-2026-11-26";

    private const string ColumnHeader = "code\ttaluka\tmr\ten\tpin\tstatus";
    private static readonly Regex Pin = new("^[1-9][0-9]{5}$", RegexOptions.CultureInvariant);
    private static readonly Lazy<LgdPlaceList> Embedded = new(() => LoadEmbedded(CurrentVersion));

    private LgdPlaceList(
        string version,
        string source,
        string provenance,
        int declaredVillages,
        int declaredTalukas,
        int declaredDistricts,
        IReadOnlyList<LgdDistrictRow> districts,
        IReadOnlyList<LgdTalukaRow> talukas,
        IReadOnlyList<LgdVillageRow> villages)
    {
        Version = version;
        Source = source;
        Provenance = provenance;
        DeclaredVillageCount = declaredVillages;
        DeclaredTalukaCount = declaredTalukas;
        DeclaredDistrictCount = declaredDistricts;
        Districts = districts;
        Talukas = talukas;
        Villages = villages;
    }

    public string Version { get; }
    public string Source { get; }
    public string Provenance { get; }
    public int DeclaredVillageCount { get; }
    public int DeclaredTalukaCount { get; }
    public int DeclaredDistrictCount { get; }
    public IReadOnlyList<LgdDistrictRow> Districts { get; }
    public IReadOnlyList<LgdTalukaRow> Talukas { get; }
    public IReadOnlyList<LgdVillageRow> Villages { get; }

    /// <summary>The list this server embeds, parsed once per process.</summary>
    public static LgdPlaceList Current => Embedded.Value;

    /// <summary>Reads the embedded files of <paramref name="version"/>; throws when either is missing or does not hold together.</summary>
    public static LgdPlaceList LoadEmbedded(string version)
    {
        var assembly = typeof(LgdPlaceList).Assembly;
        using var tsv = Open(assembly, $"User.Infrastructure.Places.{version}.tsv");
        using var areas = Open(assembly, $"User.Infrastructure.Places.{version}-areas.json");
        return Parse(version, tsv, areas);
    }

    /// <summary>
    /// Parses one version of the list. Throws <see cref="InvalidDataException"/> (with the reason in words) when anything does not hold
    /// together; nothing is ever repaired or guessed.
    /// </summary>
    public static LgdPlaceList Parse(string version, TextReader tsv, TextReader areasJson)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(version);
        ArgumentNullException.ThrowIfNull(tsv);
        ArgumentNullException.ThrowIfNull(areasJson);

        var header = ReadLine(tsv) ?? throw Bad(version, "the village file is empty");
        var parts = header.Split('\t');
        if (parts[0] != "#" + version)
        {
            throw Bad(version, $"the village file names version '{parts[0].TrimStart('#')}'");
        }

        var meta = parts.Skip(1)
            .Select(p => p.Split('=', 2))
            .Where(kv => kv.Length == 2)
            .ToDictionary(kv => kv[0], kv => kv[1], StringComparer.Ordinal);
        var source = Required(meta, "source", version);
        var provenance = Required(meta, "provenance", version);
        var declaredVillages = Count(meta, "villages", version);
        var declaredTalukas = Count(meta, "talukas", version);
        var declaredDistricts = Count(meta, "districts", version);

        using var document = JsonDocument.Parse(areasJson.ReadToEnd());
        var root = document.RootElement;
        if (root.GetProperty("version").GetString() != version)
        {
            throw Bad(version, "the area file names another version");
        }

        var districts = new List<LgdDistrictRow>();
        var districtCodes = new HashSet<int>();
        foreach (var d in root.GetProperty("districts").EnumerateArray())
        {
            var row = new LgdDistrictRow(d.GetProperty("code").GetInt32(), Text(d, "en"), Text(d, "mr"));
            if (row.Code <= 0 || row.NameEn.Length == 0 || row.NameMr.Length == 0 || !districtCodes.Add(row.Code))
            {
                throw Bad(version, $"district {row.Code} is unnamed or listed twice");
            }

            districts.Add(row);
        }

        var talukas = new List<LgdTalukaRow>();
        var talukaCodes = new HashSet<int>();
        foreach (var t in root.GetProperty("talukas").EnumerateArray())
        {
            if (t.TryGetProperty("mr", out _))
            {
                throw Bad(version, "a taluka carries a Marathi name; none is loaded until founder question 8 is answered");
            }

            var row = new LgdTalukaRow(t.GetProperty("code").GetInt32(), t.GetProperty("district").GetInt32(), Text(t, "en"));
            if (row.Code <= 0 || row.NameEn.Length == 0 || !districtCodes.Contains(row.DistrictCode) || !talukaCodes.Add(row.Code))
            {
                throw Bad(version, $"taluka {row.Code} is unnamed, listed twice or in an unknown district");
            }

            talukas.Add(row);
        }

        if (ReadLine(tsv) != ColumnHeader)
        {
            throw Bad(version, "the village file's column line is not '" + ColumnHeader.Replace('\t', ' ') + "'");
        }

        var villages = new List<LgdVillageRow>(declaredVillages);
        var villageCodes = new HashSet<int>();
        var lineNumber = 2;
        for (var line = ReadLine(tsv); line is not null; line = ReadLine(tsv))
        {
            lineNumber++;
            if (line.Length == 0)
            {
                continue;
            }

            var f = line.Split('\t');
            if (f.Length != 6
                || !int.TryParse(f[0], NumberStyles.None, CultureInfo.InvariantCulture, out var code)
                || !int.TryParse(f[1], NumberStyles.None, CultureInfo.InvariantCulture, out var taluka)
                || code <= 0)
            {
                throw Bad(version, $"line {lineNumber} is not code, taluka, Marathi name, English name, PIN, status");
            }

            if (!villageCodes.Add(code))
            {
                throw Bad(version, $"village {code} is listed twice");
            }

            if (!talukaCodes.Contains(taluka))
            {
                throw Bad(version, $"village {code} names taluka {taluka}, which is not listed");
            }

            if (f[3].Length == 0)
            {
                throw Bad(version, $"village {code} has no English name");
            }

            if (f[4].Length != 0 && !Pin.IsMatch(f[4]))
            {
                throw Bad(version, $"village {code} has a PIN that is not six digits");
            }

            var status = f[5] switch
            {
                "I" => LgdVillageStatus.Inhabited,
                "U" => LgdVillageStatus.Uninhabited,
                "F" => LgdVillageStatus.Forest,
                _ => throw Bad(version, $"village {code} has an unknown status '{f[5]}'"),
            };
            villages.Add(new LgdVillageRow(code, taluka, f[2].Length == 0 ? null : f[2], f[3], f[4].Length == 0 ? null : f[4], status));
        }

        if (villages.Count != declaredVillages || talukas.Count != declaredTalukas || districts.Count != declaredDistricts)
        {
            throw Bad(version,
                $"the files hold {villages.Count} villages, {talukas.Count} talukas and {districts.Count} districts; "
                + $"the version line says {declaredVillages}, {declaredTalukas} and {declaredDistricts}");
        }

        return new LgdPlaceList(version, source, provenance, declaredVillages, declaredTalukas, declaredDistricts, districts, talukas, villages);
    }

    private static TextReader Open(Assembly assembly, string name)
    {
        var stream = assembly.GetManifestResourceStream(name)
            ?? throw new InvalidDataException($"The embedded place list file '{name}' is missing from {assembly.GetName().Name}.");
        return new StreamReader(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), detectEncodingFromByteOrderMarks: true);
    }

    // A checkout may turn LF into CRLF (core.autocrlf): the carriage return is never part of a value.
    private static string? ReadLine(TextReader reader) => reader.ReadLine()?.TrimEnd('\r');

    private static string Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()!.Trim() : string.Empty;

    private static string Required(Dictionary<string, string> meta, string key, string version) =>
        meta.TryGetValue(key, out var value) && value.Length > 0 ? value : throw Bad(version, $"the version line has no {key}");

    private static int Count(Dictionary<string, string> meta, string key, string version) =>
        meta.TryGetValue(key, out var raw) && int.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out var count) && count > 0
            ? count
            : throw Bad(version, $"the version line has no {key} count");

    private static InvalidDataException Bad(string version, string reason) =>
        new($"Place list {version}: {reason}. Nothing was loaded.");
}
