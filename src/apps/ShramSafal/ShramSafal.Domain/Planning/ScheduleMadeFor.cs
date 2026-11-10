namespace ShramSafal.Domain.Planning;

/// <summary>
/// spec: plr-d10 lane SCH-OWN-c (founder D-137, Q10 = 1) - what a schedule was MADE FOR: the variety, the soil, the region and the climate it
/// was written with in mind. Four TAGS, each optional, each a short code (<see cref="MaxTagLength"/>); never a refusal: the server never refuses a
/// plot a schedule because of them (the phone, part b, may show a soft line). The crop stays the schedule's own required field and the days stay
/// derived from its stages. Which codes exist is NOT the domain's: the lists live in <c>sync-contract/schemas/schedule-made-for.json</c> and the
/// Application layer checks membership (<c>MadeForLists</c>), as it does for crop keys. The domain checks the shape only (<see cref="Check"/>).
/// </summary>
public sealed record ScheduleMadeFor(string? Variety, string? SoilType, string? Region, string? Climate)
{
    /// <summary>No tag at all.</summary>
    public static readonly ScheduleMadeFor None = new(null, null, null, null);

    /// <summary>The width of each tag column (<c>variety</c>, <c>soil_type</c>, <c>region_code</c>, <c>climate</c>: varchar(40)).</summary>
    public const int MaxTagLength = 40;

    /// <summary>True when no tag is set.</summary>
    public bool IsEmpty => Variety is null && SoilType is null && Region is null && Climate is null;

    /// <summary>Trims each tag; a blank tag is no tag.</summary>
    public ScheduleMadeFor Normalize() => new(Clean(Variety), Clean(SoilType), Clean(Region), Clean(Climate));

    /// <summary>
    /// The shape rule: a tag may be at most <see cref="MaxTagLength"/> characters and may hold no control character. Returns the problem
    /// (code <c>ScheduleMadeFor</c>) or <c>null</c>. List membership is the Application layer's (<c>MadeForLists.Check</c>).
    /// </summary>
    public static ScheduleImportProblem? Check(ScheduleMadeFor tags)
    {
        ArgumentNullException.ThrowIfNull(tags);
        foreach (var (name, value) in new[] { ("variety", tags.Variety), ("soilType", tags.SoilType), ("region", tags.Region), ("climate", tags.Climate) })
        {
            if (value is null)
            {
                continue;
            }

            if (value.Length > MaxTagLength)
            {
                return new("ScheduleMadeFor", $"The {name} tag may be at most {MaxTagLength} characters.");
            }

            if (value.Any(char.IsControl))
            {
                return new("ScheduleMadeFor", $"The {name} tag may hold no control character.");
            }
        }

        return null;
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
