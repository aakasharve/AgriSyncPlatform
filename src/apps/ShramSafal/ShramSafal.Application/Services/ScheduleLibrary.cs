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
/// <item><b>Which rows a caller may list and adopt</b> — the ONE visibility rule (<see cref="ScheduleViewer"/>, shared with
/// the schedule lineage read, clone and edit): Public; his own schedules (any scope); a Team schedule of the owner of a farm
/// he works on. Any other row (another account's Private, Team or Licensed one) is never listed to him and is answered
/// exactly like an unknown id (E4).</item>
/// <item><b>Listed = adoptable</b> (fix round 1, review H2): his library is <see cref="ListingForAsync"/> — the rows he may
/// see, else the built-in catalog — and <see cref="FindAsync"/> reads exactly that list. So a built-in id is adoptable while
/// his library is the built-in one, and not once it lists rows (it would answer a schedule his phone no longer shows).</item>
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
    /// <c>null</c> when his library does not list it (an unknown id and a schedule he may not see answer alike).
    /// </summary>
    public async Task<ScheduleTemplateDto?> FindAsync(Guid templateId, Guid callerUserId, CancellationToken ct = default)
    {
        if (templateId == Guid.Empty)
        {
            return null;
        }

        var listed = await ListingForAsync(repository, await repository.GetScheduleTemplatesAsync(ct), callerUserId, ct);
        return listed.FirstOrDefault(t => t.Id == templateId);
    }

    /// <summary>
    /// spec: plr-d10 lane L8b-1 fix round 1 (review H2) — <paramref name="callerUserId"/>'s library, exactly as his phone
    /// receives it (the reference route and the pull): the rows of <paramref name="rows"/> he may see
    /// (<see cref="ScheduleViewer"/>), else the built-in catalog. Its version hash is computed over THIS list, so it is his
    /// list's version: a row he may not see never changes what his phone is told.
    /// </summary>
    public static async Task<IReadOnlyList<ScheduleTemplateDto>> ListingForAsync(
        IShramSafalRepository repository, IReadOnlyList<ScheduleTemplate> rows, Guid callerUserId, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(rows);
        var visible = await new ScheduleViewer(repository, callerUserId, rows).VisibleAsync(rows, ct);

        // spec: plr-d10 lane SCH-A (Task 1) - the check rides on THIS filtered list only (never on the unfiltered rows): the
        // latest decision of each visible row that stores its days. A row that stores none can have no check (R3).
        IReadOnlyList<ScheduleCheck> checks = visible.Count == 0
            ? []
            : await repository.GetScheduleChecksAsync(visible.Where(r => r.HasStoredDays).Select(r => r.Id).ToList(), ct);
        return GetScheduleTemplatesHandler.Listing(visible, checks);
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

    /// <summary>
    /// Does <paramref name="template"/> belong to the crop of a season named <paramref name="cycleCropName"/>? A name the
    /// rule cannot read (<see cref="UnknownCrop"/>) is never a crop, so it matches nothing — not even another unreadable
    /// name, nor itself (fix round 1, review L5; the phone's <c>getTemplatesForCrop</c> answers the same).
    /// </summary>
    public static bool MatchesCrop(ScheduleTemplateDto template, string? cycleCropName)
    {
        ArgumentNullException.ThrowIfNull(template);
        var crop = CropCode(cycleCropName);
        return !string.Equals(crop, UnknownCrop, StringComparison.Ordinal)
            && string.Equals(CropCode(template.CropType), crop, StringComparison.Ordinal);
    }

    /// <summary>
    /// The crop a name means, as the phone's schedule library reads it (<c>TemplateCatalog.scheduleCropCode</c>): read
    /// through the crop master (<c>cropMaster.cropByName</c>: a canonical name first, then an alternate; one crop, or
    /// several forms of one base crop), its English name taken, then the phone's canonical crop code.
    /// </summary>
    public static string CropCode(string? name)
    {
        return CropCodeCore(name);
    }

    /// <summary>
    /// spec: plr-d10 lane SCH-A fix round 1 (S006) - the crop-type NAME a stored row lists under, the same name the thin rows
    /// and <see cref="GetScheduleTemplatesHandler.BuildCropTypes"/> use: the built-in catalog's crop of that code ("Grapes"),
    /// else the crop master's English name. Null when the key is no known crop (import refuses it).
    /// </summary>
    public static string? CropTypeNameFor(string? cropKey)
    {
        if (string.IsNullOrWhiteSpace(cropKey))
        {
            return null;
        }

        var code = CropCode(cropKey);
        if (string.Equals(code, UnknownCrop, StringComparison.Ordinal))
        {
            return null;
        }

        var builtIn = ReferenceDataCatalog.CropTypes.FirstOrDefault(c => string.Equals(CropCode(c.Name), code, StringComparison.Ordinal));
        return builtIn?.Name ?? CropMasterNames.EnglishNameOf(cropKey);
    }

    private static string CropCodeCore(string? name)
    {
        var english = CropMasterNames.EnglishNameOf(name) ?? name ?? string.Empty;
        return CanonicalCropCode(english);
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
