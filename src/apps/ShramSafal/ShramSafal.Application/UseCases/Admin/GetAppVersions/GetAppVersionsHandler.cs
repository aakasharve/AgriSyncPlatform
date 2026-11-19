using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetAppVersions;

public sealed record GetAppVersionsQuery(int? Days, Guid ActorId);

/// <summary>
/// spec: control-room-app-versions-2026-11-12 (ADR 0028). Who used the farmer
/// app on which version. The repository hands over rows; every counting rule
/// is here, as pure code:
/// <list type="bullet">
/// <item>a person counts once, on the version of their MOST RECENT row in the
/// period (not the highest version they ever had);</item>
/// <item>versions are ordered by their dot-separated numbers, so 1.0.9 is
/// older than 1.0.18; a part that is not a number sorts lowest;</item>
/// <item>"newest" is the highest version people are counted on, so the newest
/// row is always in the table; the server does not know what the store has
/// published;</item>
/// <item>people on a lower version are listed, most recently seen first, at
/// most <see cref="MaxOlderVersionPeople"/>.</item>
/// </list>
///
/// <para>
/// <b>A repository failure is not caught.</b> It escapes to the server's own
/// error path, which logs it and answers 500. An empty answer would tell the
/// team that nobody is on an older version.
/// </para>
/// </summary>
public sealed class GetAppVersionsHandler(IAdminOpsRepository opsRepo, TimeProvider clock)
{
    public const int MaxOlderVersionPeople = 200;

    /// <summary>
    /// The number every release up to 1.0.17 sends as its version: until then
    /// the app sent the version in its <c>package.json</c>, which was never a
    /// release. From 1.0.18 it sends its real version. So a row on this number
    /// means "1.0.17 or earlier", and 1.0.15, 1.0.16 and 1.0.17 cannot be told
    /// apart. It is named in every answer so the page can word those rows;
    /// nothing is rewritten and nothing is counted differently because of it
    /// (it already sorts below every real release).
    /// </summary>
    public const string LegacyVersionNumber = "0.9.0";

    public async Task<Result<AdminResponseDto<AppVersionsDto>>> HandleAsync(
        GetAppVersionsQuery query, CancellationToken ct = default)
    {
        // The page offers 7 and 30 days. Anything else is 7.
        var days = query.Days == 30 ? 30 : 7;
        var nowUtc = clock.GetUtcNow().UtcDateTime;
        var sinceUtc = nowUtc.AddDays(-days);

        var rows = await opsRepo.GetAppSeenAsync(sinceUtc, ct);
        var measuredSinceUtc = await opsRepo.GetAppSeenStartAsync(ct);
        var devices = await opsRepo.GetSignInDevicesAsync(sinceUtc, ct);

        var people = LatestUsePerPerson(rows);
        var versions = CountByVersion(people);
        var onOlderVersions = await DescribePeopleBehindAsync(people, versions, query.ActorId, ct);

        var data = new AppVersionsDto(
            Days: days,
            MeasuredSinceUtc: measuredSinceUtc,
            People: people.Count,
            Phones: devices.Phones,
            OtherDevices: devices.OtherDevices,
            PeopleWithUnknownDevice: devices.PeopleWithUnknownDevice,
            NewestVersion: versions.Count > 0 ? versions[0].AppVersion : null,
            LegacyVersionNumber: LegacyVersionNumber,
            Versions: versions,
            OnOlderVersions: onOlderVersions);

        return Result.Success(new AdminResponseDto<AppVersionsDto>(data,
            new AdminMetaDto(
                Source: "live",
                Window: $"last {days} days",
                LastRefreshedUtc: nowUtc,
                TtlSeconds: 0)));
    }

    /// <summary>One row per person: their most recent use in the period (the shared rule, plan CR-2c E9).</summary>
    private static List<AppSeenRow> LatestUsePerPerson(IReadOnlyList<AppSeenRow> rows) =>
        AppVersionRules.LatestPerPerson(rows, r => r.PersonId, r => r.SeenAtUtc, r => r.AppVersion);

    /// <summary>
    /// One row per version somebody is counted on, newest first. Two spellings
    /// of the same number (1.0 and 1.0.0) are both "newest" when they are the
    /// highest, so nobody is called behind for a spelling.
    /// </summary>
    private static List<AppVersionRowDto> CountByVersion(List<AppSeenRow> people)
    {
        var counted = people
            .GroupBy(p => p.AppVersion, StringComparer.Ordinal)
            .Select(g => (AppVersion: g.Key, People: g.Count()))
            .OrderByDescending(v => v.AppVersion, AppVersionRules.VersionOrder)
            .ThenByDescending(v => v.AppVersion, StringComparer.Ordinal)
            .ToList();

        if (counted.Count == 0)
        {
            return [];
        }

        var newest = counted[0].AppVersion;

        return counted
            .Select(v => new AppVersionRowDto(
                v.AppVersion,
                v.People,
                IsNewest: AppVersionRules.VersionOrder.Compare(v.AppVersion, newest) == 0))
            .ToList();
    }

    /// <summary>
    /// The people whose version is lower than the newest, with their names and
    /// farm names. Names and farms are asked for only when somebody is behind,
    /// only about those people, and the cross-farm read (one audit row each
    /// time it is opened) is asked exactly once.
    /// </summary>
    private async Task<IReadOnlyList<OlderVersionPersonDto>> DescribePeopleBehindAsync(
        List<AppSeenRow> people, List<AppVersionRowDto> versions, Guid actorId, CancellationToken ct)
    {
        var olderVersions = versions
            .Where(v => !v.IsNewest)
            .Select(v => v.AppVersion)
            .ToHashSet(StringComparer.Ordinal);

        var behind = people
            .Where(p => olderVersions.Contains(p.AppVersion))
            .OrderByDescending(p => p.SeenAtUtc)
            .ThenBy(p => p.PersonId)
            .Take(MaxOlderVersionPeople)
            .ToList();

        if (behind.Count == 0)
        {
            return [];
        }

        var personIds = behind.Select(p => p.PersonId).ToArray();
        var names = await opsRepo.GetPeopleNamesAsync(personIds, ct);
        var farmNames = await opsRepo.GetFarmNamesByPersonAsync(actorId, personIds, ct);

        // No user record, or a blank name: Name is null. The page says "No
        // name on record"; nothing is made up here.
        return behind
            .Select(p => new OlderVersionPersonDto(
                Name: names.TryGetValue(p.PersonId, out var name) && !string.IsNullOrWhiteSpace(name) ? name : null,
                FarmNames: farmNames.TryGetValue(p.PersonId, out var farms) ? farms : [],
                AppVersion: p.AppVersion,
                LastSeenUtc: p.SeenAtUtc))
            .ToList();
    }
}
