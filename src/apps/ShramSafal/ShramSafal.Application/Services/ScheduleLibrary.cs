using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;

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
/// <summary>
/// spec: plr-d10 lane L8b-1F - what <see cref="ScheduleLibrary.ChooseAsync"/> found a plot may follow: the schedule as listed,
/// whose it is (<see cref="Origin"/>), what the check said when chosen (<see cref="CheckStateAtAdopt"/>, stored; <c>null</c> for a farm's own
/// schedule, which no check applies to - SCH-OWN, D-82 = 3) and what it says now (<see cref="LiveCheckState"/>, shown).
/// </summary>
public sealed record ScheduleChoice(
    ScheduleTemplateDto Template,
    ScheduleOrigin Origin,
    ScheduleCheckState? CheckStateAtAdopt,
    ScheduleCheckState LiveCheckState);

public sealed class ScheduleLibrary(IShramSafalRepository repository)
{
    /// <summary>The crop code the phone gives a name it cannot read (TemplateCatalog <c>canonicalCropCode</c>).</summary>
    public const string UnknownCrop = "unknown_crop";

    /// <summary>
    /// The library schedule <paramref name="templateId"/> as <paramref name="callerUserId"/>'s phone LISTS it for a new choice
    /// (his farm view: <see cref="ListingForAsync"/>), or <c>null</c> when his library does not list it (an unknown id, a schedule
    /// he may not see, a delisted sample and a schedule still waiting for its check all answer alike). Adoption does not use this
    /// one: it needs to tell "not listed" from "not checked" - see <see cref="ChooseAsync"/>.
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
    /// spec: plr-d10 lane L8b-1F (R7; F114) - the schedule a phone chose BEFORE this lane (and holds), found even when the
    /// listing no longer offers it: the listing, else a built-in id. Never a way to make a NEW choice: a carry-over keeps a choice
    /// the farmer already made (P10). A schedule he may not see is still not found (E4).
    /// </summary>
    public async Task<ScheduleTemplateDto?> FindForCarryOverAsync(Guid templateId, Guid callerUserId, CancellationToken ct = default)
    {
        if (templateId == Guid.Empty)
        {
            return null;
        }

        var (_, _, pool) = await PoolAsync(repository, await repository.GetScheduleTemplatesAsync(ct), callerUserId, ct);
        return pool.FirstOrDefault(t => t.Id == templateId);
    }

    /// <summary>
    /// spec: plr-d10 lane L8b-1 fix round 1 (review H2) - <paramref name="callerUserId"/>'s library, exactly as his phone
    /// receives it (the reference route and the pull). L8b-1F (F114): <b>the rows he may see PLUS the samples by crop</b>
    /// (<see cref="GetScheduleTemplatesHandler.Listing"/>), and for a platform reviewer (asked only when a row waiting for its
    /// check is among his rows) every row with its state. Its version hash is computed over THIS list, so it is his list's
    /// version: a row he may not see never changes what his phone is told.
    /// </summary>
    public static async Task<IReadOnlyList<ScheduleTemplateDto>> ListingForAsync(
        IShramSafalRepository repository,
        IReadOnlyList<ScheduleTemplate> rows,
        Guid callerUserId,
        CancellationToken ct = default,
        IEntitlementResolver? entitlements = null)
    {
        ArgumentNullException.ThrowIfNull(rows);
        var (visible, checks, _) = await ReadAsync(repository, rows, callerUserId, ct);
        var mode = ScheduleListingMode.Farm;
        if (entitlements is not null && callerUserId != Guid.Empty && HasRowHiddenFromFarm(visible, checks)
            && await entitlements.MayCheckSchedulesAsync(new UserId(callerUserId), ct))
        {
            mode = ScheduleListingMode.Reviewer;
        }

        return GetScheduleTemplatesHandler.Listing(visible, checks, mode);
    }

    /// <summary>
    /// spec: plr-d10 lane L8b-1F (R7, P10) - these schedules (the ones a person's plots already follow) as listed, whether or not
    /// they are still listed for a NEW choice. Only what he may see; an id he may not see is not returned.
    /// </summary>
    public static async Task<IReadOnlyList<ScheduleTemplateDto>> FollowedAsync(
        IShramSafalRepository repository, IReadOnlyList<ScheduleTemplate> rows, Guid callerUserId, IReadOnlyCollection<Guid> ids, CancellationToken ct = default)
    {
        var (_, _, pool) = await PoolAsync(repository, rows, callerUserId, ct);
        return pool.Where(t => ids.Contains(t.Id)).ToList();
    }

    private static async Task<(List<ScheduleTemplate> Visible, IReadOnlyList<ScheduleCheck> Checks, ScheduleViewer Viewer)> ReadAsync(
        IShramSafalRepository repository, IReadOnlyList<ScheduleTemplate> rows, Guid callerUserId, CancellationToken ct)
    {
        var viewer = new ScheduleViewer(repository, callerUserId, rows);
        var visible = await viewer.VisibleAsync(rows, ct);

        // spec: plr-d10 lane SCH-A (Task 1) - the check rides on THIS filtered list only (never on the unfiltered rows): the
        // latest decision of each visible row that stores its days. A row that stores none can have no check (R3).
        IReadOnlyList<ScheduleCheck> checks = visible.Count == 0
            ? []
            : await repository.GetScheduleChecksAsync(visible.Where(r => r.HasStoredDays).Select(r => r.Id).ToList(), ct);
        return (visible, checks, viewer);
    }

    private static async Task<(List<ScheduleTemplate> Visible, ScheduleViewer Viewer, IReadOnlyList<ScheduleTemplateDto> Pool)> PoolAsync(
        IShramSafalRepository repository, IReadOnlyList<ScheduleTemplate> rows, Guid callerUserId, CancellationToken ct)
    {
        var (visible, checks, viewer) = await ReadAsync(repository, rows, callerUserId, ct);
        return (visible, viewer, GetScheduleTemplatesHandler.Listing(visible, checks, ScheduleListingMode.Pool));
    }

    /// <summary>A Public row that stores its days and is neither Checked nor Withdrawn: a farm caller is never shown it.</summary>
    private static bool HasRowHiddenFromFarm(IReadOnlyList<ScheduleTemplate> visible, IReadOnlyList<ScheduleCheck> checks)
    {
        var byRow = checks.GroupBy(c => c.ScheduleTemplateId).ToDictionary(g => g.Key, g => g.ToList());
        return visible.Any(r =>
            r.TenantScope == TenantScope.Public && r.HasStoredDays
            && ScheduleCheck.StateOf(byRow.GetValueOrDefault(r.Id) ?? []) is not (ScheduleCheckState.Checked or ScheduleCheckState.Withdrawn));
    }

    /// <summary>
    /// spec: plr-d10 lane L8b-1F Tasks 1-3 - the ONE place adopt and migrate decide whether a plot may follow a schedule
    /// (E4, R23, D-82, D-91 = 1, R7). In order:
    /// <list type="number">
    /// <item>Not found among what he may see (<see cref="ScheduleViewer"/>) or among the built-in samples - or
    /// <see cref="FollowableOnPlot.Classify"/> says this plot's farm may not follow it (another farm's Team row, any Private
    /// row): <see cref="ShramSafalErrors.ScheduleTemplateNotFound"/>, exactly like an unknown id.</item>
    /// <item>Another crop than the season's: <see cref="ShramSafalErrors.ScheduleTemplateCropMismatch"/>.</item>
    /// <item>A farm's own schedule (SCH-OWN, D-82 = 3): ONLY a row whose <c>own_farm_id</c> is this plot's farm (fix round 1, M001; session A's
    /// ruling). One that stores no days is <see cref="ShramSafalErrors.OwnScheduleEmpty"/>; one that does is accepted with NO check (stamped with no
    /// check state). A Team row that names no farm - every row made before the lane, and a plain Team copy of any schedule, a Withdrawn one
    /// included - is recognised as his team's (<see cref="FollowableOnPlot.Classify"/>, so it is not "not found") but is NOT a farm's own schedule: it
    /// answers <see cref="ShramSafalErrors.OwnScheduleNotOpenYet"/>, exactly what x1 answered for it, and nothing is written.</item>
    /// <item>An Outside schedule: Checked is accepted. A carry-over (the phone's earlier choice, R7) is always accepted. A
    /// <b>sample</b> (a built-in id, or a library row that stores no days) is accepted, stamped NotChecked, while its crop has no
    /// Checked Outside schedule; once it has one: <see cref="ShramSafalErrors.ScheduleNotChecked"/>. Any other unchecked row
    /// (waiting, sent back, withdrawn): <see cref="ShramSafalErrors.ScheduleNotChecked"/>.</item>
    /// </list>
    /// </summary>
    public async Task<Result<ScheduleChoice>> ChooseAsync(
        Guid templateId, Guid callerUserId, Guid plotFarmOwnerUserId, Guid plotFarmId, string? cropName, bool carryOver, CancellationToken ct = default)
    {
        if (templateId == Guid.Empty)
        {
            return Result.Failure<ScheduleChoice>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        var rows = await repository.GetScheduleTemplatesAsync(ct);
        var (visible, viewer, pool) = await PoolAsync(repository, rows, callerUserId, ct);
        var template = pool.FirstOrDefault(t => t.Id == templateId);
        if (template is null)
        {
            return Result.Failure<ScheduleChoice>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        var row = visible.FirstOrDefault(r => r.Id == templateId);
        var isBuiltIn = row is null && ReferenceDataCatalog.ScheduleTemplates.Any(t => t.Id == templateId);
        var scope = row?.TenantScope ?? TenantScope.Public;
        var owner = row is null ? null : await viewer.OwnerOfAsync(row, ct);
        // spec: plr-d10 lane SCH-OWN (R30) - a row that names its farm is Own exactly on a plot of THAT farm (not on the same owner's other farm).
        var origin = FollowableOnPlot.Classify(scope, owner, isBuiltIn, plotFarmOwnerUserId, row?.OwnFarmId, plotFarmId);
        if (origin is null || (row is null && !isBuiltIn))
        {
            return Result.Failure<ScheduleChoice>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        if (!MatchesCrop(template, cropName))
        {
            return Result.Failure<ScheduleChoice>(ShramSafalErrors.ScheduleTemplateCropMismatch);
        }

        var live = Enum.TryParse<ScheduleCheckState>(template.Check?.State, out var parsed) ? parsed : ScheduleCheckState.NotChecked;
        if (origin == ScheduleOrigin.Own)
        {
            // Fix round 1 (M001): a Team row that names no farm is not a farm's own schedule - no check applies to a row only because it is
            // Team and its owner's. It stays closed, with x1's own answer.
            if (row?.OwnFarmId is null)
            {
                return Result.Failure<ScheduleChoice>(ShramSafalErrors.OwnScheduleNotOpenYet);
            }

            // SCH-OWN Task 3 (D-82 = 3): no check applies to a farm's own schedule - it is accepted exactly when it STORES its days (the
            // same rule NewChoiceOpen gives the planning gate), stamped with NO check state; one that stores none has nothing to follow
            // (P4: never an invented stage or day), so nothing is written.
            return NewChoiceOpen(origin, isBuiltIn, row.HasStoredDays, live, cropHasChecked: false)
                ? Result.Success(new ScheduleChoice(template, origin.Value, null, live))
                : Result.Failure<ScheduleChoice>(ShramSafalErrors.OwnScheduleEmpty);
        }

        var atAdopt = live == ScheduleCheckState.Checked ? ScheduleCheckState.Checked : ScheduleCheckState.NotChecked;
        if (live != ScheduleCheckState.Checked)
        {
            // A carry-over (R7) bridges SAMPLES only (a built-in id, or a Public row WITHOUT stored days) and a row whose check was
            // withdrawn; a Public row WITH stored days that is waiting or sent back is refused even then (D-82: it is never shown).
            var isSample = isBuiltIn || row is { HasStoredDays: false };
            var bridged = carryOver && (isSample || live == ScheduleCheckState.Withdrawn);
            var rowById = visible.GroupBy(r => r.Id).ToDictionary(g => g.Key, g => g.First());
            var cropHasChecked = GetScheduleTemplatesHandler.CheckedOutsideCrops(pool, rowById).Contains(CropGroupKey(template.CropType));
            // spec: plr-d10 lane SCH-GATE-a - the "a new choice is open" rule is shared with the planning gate (NewChoiceOpen).
            var newChoiceOpen = NewChoiceOpen(origin, isBuiltIn, row?.HasStoredDays ?? false, live, cropHasChecked);
            if (!bridged && !newChoiceOpen)
            {
                return Result.Failure<ScheduleChoice>(ShramSafalErrors.ScheduleNotChecked);
            }
        }

        return Result.Success(new ScheduleChoice(template, origin.Value, atAdopt, live));
    }

    /// <summary>
    /// spec: plr-d10 lane SCH-GATE-a (D-83 = 1, D-82 = 3, D-91 = 1, R7) - the ONE rule "may this listed schedule be chosen NEW on this
    /// plot-season right now?", read by <see cref="ChooseAsync"/> (adopt and migrate) and by the planning gate, so the gate never asks
    /// him to choose what adopt would refuse (P5). Pure.
    /// <list type="bullet">
    /// <item><paramref name="origin"/> <c>null</c> (the plot's farm may not follow it - <see cref="FollowableOnPlot.Classify"/>): closed.</item>
    /// <item><see cref="ScheduleOrigin.Own"/> (SCH-OWN, D-82 = 3): a TRUE own schedule (one that names the plot's farm - the callers give
    /// <c>null</c> for a Team row that names none, M001) is open exactly when it stores its days - no check applies to it; an empty one is
    /// refused by adopt (<see cref="ShramSafalErrors.OwnScheduleEmpty"/>).</item>
    /// <item>Outside and <b>Checked</b> now: open.</item>
    /// <item>Outside and a <b>sample</b> (a built-in id, or a row that stores no days): open exactly while its crop has no Checked
    /// Outside schedule (<paramref name="cropHasChecked"/>).</item>
    /// <item>Any other Outside row (waiting, sent back, withdrawn): closed. A carry-over is a separate thing <see cref="ChooseAsync"/>
    /// still allows (R7); it is not a NEW choice.</item>
    /// </list>
    /// </summary>
    public static bool NewChoiceOpen(
        ScheduleOrigin? origin, bool isBuiltIn, bool hasStoredDays, ScheduleCheckState live, bool cropHasChecked)
    {
        if (origin is null)
        {
            return false;
        }

        // spec: plr-d10 lane SCH-OWN (D-82 = 3) - the farm's own schedule is open exactly when it STORES its days: no check applies to it, so
        // neither the check state nor the crop's checked schedules matter; an empty one has nothing to follow (OwnScheduleEmpty).
        if (origin == ScheduleOrigin.Own)
        {
            return hasStoredDays;
        }

        if (live == ScheduleCheckState.Checked)
        {
            return true;
        }

        var isSample = isBuiltIn || !hasStoredDays;
        return isSample && !cropHasChecked;
    }

    /// <summary>
    /// The crop groups (<see cref="CropGroupKey"/>) of a LISTING that hold a Checked Outside schedule - the listing-side twin of
    /// <see cref="GetScheduleTemplatesHandler.CheckedOutsideCrops"/> (which reads rows): an Outside row is a Public one, and a built-in
    /// sample carries no scope and is never Checked.
    /// </summary>
    public static HashSet<string> CheckedOutsideCropsOf(IEnumerable<ScheduleTemplateDto> listing) =>
        listing
            .Where(d => string.Equals(d.Scope, nameof(TenantScope.Public), StringComparison.Ordinal)
                        && d.Check?.State == nameof(ScheduleCheckState.Checked))
            .Select(d => CropGroupKey(d.CropType))
            .ToHashSet(StringComparer.Ordinal);

    /// <summary>
    /// The version a subscription keeps of the schedule it adopted: the listed version hash, cut to what
    /// <c>ssf.schedule_subscriptions.schedule_version_tag</c> holds (32 characters; a SHA-256 hex is 64).
    /// </summary>
    public static string VersionTagOf(ScheduleTemplateDto template)
    {
        ArgumentNullException.ThrowIfNull(template);
        // spec: plr-d10 lane L8b-1F (repo fact 12) - a library row keeps its OWN version ("v<Version>", SCH-A's RowVersionTag), so an
        // edit of a followed schedule (a new row) is visible as another version; a built-in sample, which has none, keeps the list hash.
        var rowTag = template.RowVersionTag?.Trim();
        if (!string.IsNullOrEmpty(rowTag))
        {
            return rowTag[..Math.Min(rowTag.Length, MaxVersionTagLength)];
        }

        var hash = template.VersionHash?.Trim() ?? string.Empty;
        return hash.Length == 0 ? "unversioned" : hash[..Math.Min(hash.Length, MaxVersionTagLength)];
    }

    /// <summary>The width of <c>schedule_version_tag</c> (ScheduleSubscriptionConfiguration).</summary>
    public const int MaxVersionTagLength = 32;

    /// <summary>
    /// spec: plr-d10 lane L8b-1F (F114) - the key a crop is grouped by when a listing decides "does THIS crop have a checked
    /// schedule?": the phone's crop code (<see cref="CropCode"/>, so "Grape" and "Grapes" are one crop), else - for a name no crop
    /// master reads - the name itself, case-blind (<see cref="GetScheduleTemplatesHandler.BuildCropTypes"/>' grouping).
    /// </summary>
    public static string CropGroupKey(string? cropType)
    {
        var code = CropCode(cropType);
        return string.Equals(code, UnknownCrop, StringComparison.Ordinal)
            ? (cropType ?? string.Empty).Trim().ToLowerInvariant()
            : code;
    }

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
