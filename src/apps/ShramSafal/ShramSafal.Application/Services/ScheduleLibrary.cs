using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 Task 1 ("one library"; L8 plan technical call T1).
/// The schedule a farmer can ADOPT is exactly what his phone's शेड्यूल लायब्ररी lists:
/// <see cref="GetScheduleTemplatesHandler.Listing"/> (the <c>ssf.schedule_templates</c> rows, else the built-in
/// <see cref="ReferenceDataCatalog"/>). Adoption used to look the id up in a second model nobody lists
/// (<c>ssf.crop_schedule_templates</c>), so every adopt from the library answered "not found". That model stays for
/// compliance only, until CMP-D2 re-points compliance.
/// <list type="bullet">
/// <item><b>Which rows a caller may adopt</b> — the F99 F-8 rule (<see cref="MaySeeAsync"/>, shared with the schedule
/// lineage read): Public, his own (any scope), and Team rows written by the owner of a farm he works on. Any other row
/// (another account's Private or Team, a Licensed one) is answered exactly like an unknown id (E4).</item>
/// <item><b>Built-in ids stay resolvable</b> after rows exist: a phone may still hold one.</item>
/// <item><b>The crop rule</b> (<see cref="MatchesCrop"/>) is the phone's own (<c>TemplateCatalog.getTemplatesForCrop</c>):
/// a name is read through the founder's crop master (<c>sync-contract/schemas/crop-names.json</c>, generated from the
/// phone's <c>cropMasterData.ts</c>), then reduced to the phone's crop code. One shared fixture pins both sides
/// (<c>sync-contract/tests/fixtures/crop-schedule-match.json</c>).</item>
/// </list>
/// </summary>
public sealed class ScheduleLibrary(IShramSafalRepository repository)
{
    /// <summary>The crop code the phone gives a name it cannot read (TemplateCatalog <c>canonicalCropCode</c>).</summary>
    public const string UnknownCrop = "unknown_crop";

    /// <summary>
    /// The library schedule <paramref name="templateId"/> as <paramref name="callerUserId"/>'s phone lists it, or
    /// <c>null</c> when there is none he may see (an unknown id and a schedule he may not see answer alike).
    /// </summary>
    public async Task<ScheduleTemplateDto?> FindAsync(Guid templateId, Guid callerUserId, CancellationToken ct = default)
    {
        if (templateId == Guid.Empty)
        {
            return null;
        }

        var rows = await repository.GetScheduleTemplatesAsync(ct);
        if (rows.FirstOrDefault(r => r.Id == templateId) is { } row)
        {
            return await MaySeeAsync(repository, row, callerUserId, ct)
                ? GetScheduleTemplatesHandler.Listing(rows).FirstOrDefault(t => t.Id == templateId)
                : null;
        }

        return ReferenceDataCatalog.ScheduleTemplates.FirstOrDefault(t => t.Id == templateId);
    }

    /// <summary>
    /// The version a subscription keeps of the schedule it adopted: the listed version hash, cut to what
    /// <c>ssf.schedule_subscriptions.schedule_version_tag</c> holds (32 characters; a SHA-256 hex is 64).
    /// </summary>
    public static string VersionTagOf(ScheduleTemplateDto template)
    {
        ArgumentNullException.ThrowIfNull(template);
        var hash = template.VersionHash?.Trim() ?? string.Empty;
        return hash.Length == 0 ? "unversioned" : hash[..Math.Min(hash.Length, MaxVersionTagLength)];
    }

    /// <summary>The width of <c>schedule_version_tag</c> (ScheduleSubscriptionConfiguration).</summary>
    public const int MaxVersionTagLength = 32;

    /// <summary>Does <paramref name="template"/> belong to the crop of a season named <paramref name="cycleCropName"/>?</summary>
    public static bool MatchesCrop(ScheduleTemplateDto template, string? cycleCropName)
    {
        ArgumentNullException.ThrowIfNull(template);
        return string.Equals(CropCode(template.CropType), CropCode(cycleCropName), StringComparison.Ordinal);
    }

    /// <summary>
    /// The crop a name means, as the phone's schedule library reads it (<c>TemplateCatalog.scheduleCropCode</c>): read
    /// through the crop master (<c>cropMaster.cropByName</c>: a canonical name first, then an alternate; one crop, or
    /// several forms of one base crop), its English name taken, then the phone's canonical crop code.
    /// </summary>
    public static string CropCode(string? name)
    {
        var english = CropMasterNames.EnglishNameOf(name) ?? name ?? string.Empty;
        return CanonicalCropCode(english);
    }

    /// <summary>
    /// The F99 F-8 visibility rule for a schedule ROW: Public; the caller's own (any scope); a Team row written by the
    /// owner of a farm the caller works on. Never a Licensed row (not sold yet), never another account's Private one.
    /// </summary>
    public static async Task<bool> MaySeeAsync(
        IShramSafalRepository repository, ScheduleTemplate template, Guid callerUserId, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(template);
        var author = template.CreatedByUserId?.Value;
        if (template.TenantScope == TenantScope.Public || (callerUserId != Guid.Empty && author == callerUserId))
        {
            return true;
        }

        return template.TenantScope == TenantScope.Team
            && author is { } teamAuthor
            && callerUserId != Guid.Empty
            && (await TeamAuthorsAsync(repository, callerUserId, ct)).Contains(teamAuthor);
    }

    /// <summary>The owners of the farms the caller works on (his team's schedules are theirs).</summary>
    public static async Task<HashSet<Guid>> TeamAuthorsAsync(IShramSafalRepository repository, Guid callerUserId, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        var owners = new HashSet<Guid>();
        foreach (var farmId in await repository.GetFarmIdsForUserAsync(callerUserId, ct))
        {
            if (await repository.GetFarmByIdAsync(farmId, ct) is { } farm)
            {
                owners.Add(farm.OwnerUserId.Value);
            }
        }

        return owners;
    }

    // ── The phone's crop code (TemplateCatalog.ts canonicalCropCode), character for character ──

    private static readonly Dictionary<string, string> CropAliases = new(StringComparer.Ordinal)
    {
        ["grapes"] = "grape",
        ["grape"] = "grape",
        ["tomatoes"] = "tomato",
        ["tomato"] = "tomato",
        ["onions"] = "onion",
        ["onion"] = "onion",
        ["pomegranate"] = "pomegranate",
        ["pomegranates"] = "pomegranate",
        ["sugarcanes"] = "sugarcane",
        ["sugarcane"] = "sugarcane",
    };

    private static readonly Regex Whitespace = new(@"\s+", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex NotCodeChars = new("[^a-z0-9_]+", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static string CanonicalCropCode(string value)
    {
        // normalizeToken → normalizeCropCode
        var token = Whitespace.Replace(value.Trim().ToLowerInvariant(), "_");
        var normalized = NotCodeChars.Replace(token, string.Empty).Trim('_');
        if (CropAliases.TryGetValue(normalized, out var alias))
        {
            return alias;
        }

        if (normalized.EndsWith('s') && CropAliases.TryGetValue(normalized[..^1], out var singular))
        {
            return singular;
        }

        return normalized.Length == 0 ? UnknownCrop : normalized;
    }

    /// <summary>
    /// The crop master's names (<c>sync-contract/schemas/crop-names.json</c>, embedded): the phone's
    /// <c>cropMaster.cropByName</c>, character for character.
    /// </summary>
    private static class CropMasterNames
    {
        private sealed record Row(string Id, string En, string Mr, string[] AltEn, string[] AltMr, string Base);

        private sealed record Document(Row[] Rows);

        private static readonly Regex Punctuation = new(
            "[()\\[\\]{}.,;:'\"’‘“”/\\\\_-]+", RegexOptions.Compiled | RegexOptions.CultureInvariant);

        private static readonly Lazy<(Dictionary<string, Row> ById, Dictionary<string, List<Row>> Canonical, Dictionary<string, List<Row>> Alternate)> Index =
            new(Load, LazyThreadSafetyMode.ExecutionAndPublication);

        /// <summary>cropMaster.normName: Unicode form, case, punctuation and spacing never decide a match.</summary>
        private static string NormName(string? value)
        {
            var text = (value ?? string.Empty).Normalize(NormalizationForm.FormC).ToLower(CultureInfo.InvariantCulture);
            return Whitespace.Replace(Punctuation.Replace(text, " "), " ").Trim();
        }

        public static string? EnglishNameOf(string? name)
        {
            var key = NormName(name);
            if (key.Length == 0)
            {
                return null;
            }

            var (byId, canonical, alternate) = Index.Value;
            var rows = canonical.TryGetValue(key, out var c) ? c : alternate.GetValueOrDefault(key);
            if (rows is null || rows.Count == 0)
            {
                return null;
            }

            if (rows.Count == 1)
            {
                return rows[0].En;
            }

            // Several rows, all forms of one base crop → that crop; otherwise two different crops share the name: none.
            var baseId = rows[0].Base;
            return rows.All(r => r.Base == baseId) && byId.TryGetValue(baseId, out var baseRow) ? baseRow.En : null;
        }

        private static (Dictionary<string, Row>, Dictionary<string, List<Row>>, Dictionary<string, List<Row>>) Load()
        {
            const string resource = "ShramSafal.Application.CropNames.json";
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource)
                ?? throw new InvalidOperationException(
                    $"The crop master's names ({resource}, from sync-contract/schemas/crop-names.json) are not embedded in ShramSafal.Application.");
            var document = JsonSerializer.Deserialize<Document>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? throw new InvalidOperationException($"{resource} could not be read.");
            if (document.Rows is not { Length: > 0 })
            {
                throw new InvalidOperationException($"{resource} holds no crop rows.");
            }

            var byId = new Dictionary<string, Row>(StringComparer.Ordinal);
            var canonical = new Dictionary<string, List<Row>>(StringComparer.Ordinal);
            var alternate = new Dictionary<string, List<Row>>(StringComparer.Ordinal);
            foreach (var row in document.Rows)
            {
                byId[row.Id] = row;
                Push(canonical, row.En, row);
                Push(canonical, row.Mr, row);
                foreach (var n in row.AltEn ?? [])
                {
                    Push(alternate, n, row);
                }

                foreach (var n in row.AltMr ?? [])
                {
                    Push(alternate, n, row);
                }
            }

            return (byId, canonical, alternate);
        }

        private static void Push(Dictionary<string, List<Row>> index, string? name, Row row)
        {
            var key = NormName(name);
            if (key.Length == 0)
            {
                return;
            }

            if (!index.TryGetValue(key, out var list))
            {
                index[key] = list = [];
            }

            if (!list.Contains(row))
            {
                list.Add(row);
            }
        }
    }
}
