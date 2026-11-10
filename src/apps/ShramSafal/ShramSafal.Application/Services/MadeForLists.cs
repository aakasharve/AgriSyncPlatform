using System.Reflection;
using System.Text.Json;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10 lane SCH-OWN-c (founder D-137, Q10 = 1; F224) - the SHORT lists a made-for tag may be chosen from, read from the ONE source
/// <c>sync-contract/schemas/schedule-made-for.json</c> (embedded here as <c>ShramSafal.Application.ScheduleMadeFor.json</c>, the way the crop
/// master's names are; the sync contract's Zod enums import the same file). The server checks a tag against its list and answers a validation
/// refusal (<c>ShramSafal.ScheduleMadeFor</c>); it never refuses a FOLLOW because of a tag (Q10: tags, never a refusal). A variety is checked per
/// crop CODE (<see cref="ScheduleLibrary.CropCode"/>): a crop with no list of its own takes <c>_other</c> (Local, Hybrid), so a Grapes schedule may
/// not say Local and a Sugarcane one may. The lists are PROPOSED, unchecked by an agronomist (F224); their Marathi labels are data for the phone.
/// </summary>
public static class MadeForLists
{
    private const string Resource = "ShramSafal.Application.ScheduleMadeFor.json";
    private const string OtherCrop = "_other";

    private sealed record Document(int Version, string[] SoilType, string[] Climate, string[] Region, Dictionary<string, string[]> Variety);

    private static readonly Lazy<Document> Lists = new(Load, LazyThreadSafetyMode.ExecutionAndPublication);

    /// <summary>The soil codes.</summary>
    public static IReadOnlyList<string> SoilTypes => Lists.Value.SoilType;

    /// <summary>The climate codes.</summary>
    public static IReadOnlyList<string> Climates => Lists.Value.Climate;

    /// <summary>The region codes.</summary>
    public static IReadOnlyList<string> Regions => Lists.Value.Region;

    /// <summary>The varieties of one crop code (<see cref="ScheduleLibrary.CropCode"/>), or the <c>_other</c> list for a crop without one.</summary>
    public static IReadOnlyList<string> VarietiesOf(string? cropCode) =>
        cropCode is not null && Lists.Value.Variety.TryGetValue(cropCode, out var list) ? list : Lists.Value.Variety[OtherCrop];

    /// <summary>
    /// Each tag of <paramref name="tags"/> that is set must be in its list (the variety in the list of <paramref name="cropKey"/>'s crop code, else
    /// <c>_other</c>); the first miss is the problem (code <c>ScheduleMadeFor</c>, words naming the value and the list). The shape rule
    /// (<see cref="ScheduleMadeFor.Check"/>) is asked first.
    /// </summary>
    public static ScheduleImportProblem? Check(string? cropKey, ScheduleMadeFor tags)
    {
        ArgumentNullException.ThrowIfNull(tags);
        var normalized = tags.Normalize();
        if (ScheduleMadeFor.Check(normalized) is { } shape)
        {
            return shape;
        }

        if (normalized.Variety is { } variety && !VarietiesOf(ScheduleLibrary.CropCode(cropKey)).Contains(variety, StringComparer.Ordinal))
        {
            return Miss(variety, "variety");
        }

        if (normalized.SoilType is { } soil && !SoilTypes.Contains(soil, StringComparer.Ordinal))
        {
            return Miss(soil, "soilType");
        }

        if (normalized.Region is { } region && !Regions.Contains(region, StringComparer.Ordinal))
        {
            return Miss(region, "region");
        }

        if (normalized.Climate is { } climate && !Climates.Contains(climate, StringComparer.Ordinal))
        {
            return Miss(climate, "climate");
        }

        return null;
    }

    private static ScheduleImportProblem Miss(string value, string list) => new("ScheduleMadeFor", $"\"{value}\" is not one of the {list} choices.");

    private static Document Load()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(Resource)
            ?? throw new InvalidOperationException(
                $"The made-for lists ({Resource}, from sync-contract/schemas/schedule-made-for.json) are not embedded in ShramSafal.Application.");
        var document = JsonSerializer.Deserialize<Document>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException($"{Resource} could not be read.");
        if (document.SoilType is not { Length: > 0 } || document.Climate is not { Length: > 0 } || document.Region is not { Length: > 0 }
            || document.Variety is null || !document.Variety.ContainsKey(OtherCrop))
        {
            throw new InvalidOperationException($"{Resource} is missing a list (soilType, climate, region, variety._other).");
        }

        return document;
    }
}
