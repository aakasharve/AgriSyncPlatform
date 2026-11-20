using System.Globalization;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;

namespace ShramSafal.Application.UseCases.Admin.GetSilentChurn;

/// <summary>
/// IsPlatformSeat is true when the caller's resolved seat belongs to the Platform organisation; MayReadPhones is the
/// farmer_phones tick (or the founder); the audit fields name the request's device and IP hash on a phone look.
/// </summary>
public sealed record GetSilentChurnQuery(
    Guid ActorId, bool IsPlatformSeat, bool MayReadPhones, string AuditDeviceId, string AuditIpHash);

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 4, C10, C26). The silent farms, named, with their
/// plan, counted live on request.
/// <list type="number">
/// <item>A caller who is not a Platform seat is refused before anything is read, so no cross-farm read is opened
/// for them (defence in depth: the route gates first).</item>
/// <item>The farm rows come from <see cref="ICompanyMisReader"/>, the Company MIS read path (farm keys once through
/// the audited factory, every farm row as the app role under row-level security, the live-count ceiling), loading
/// entries from the start of the India day <see cref="LoadedDays"/> days before today.</item>
/// <item>Each farm's age is <see cref="CompanyMisCalculator.LastEntryAgeAt(DateOnly[], DateOnly?, DateOnly)"/>, the
/// rule Company MIS Retention counts its bands with, on the same rows (test accounts left out the same way), so the
/// list counted by band equals those numbers for a range ending today. Farms with an entry 0 to 6 India days ago are
/// not listed; farms owned by a test account are left out.</item>
/// <item>Names, owner phones and owner accounts come from <see cref="IAdminMisRepository.GetFarmContactsAsync"/>
/// (one more audited factory open, only when a farm is listed).</item>
/// <item>Each listed farm's plan is read through <see cref="ISubscriptionReader.GetByOwnerAccountAsync"/> inside
/// that farm's own scope (<see cref="RlsIdentityScope.RunAsFarmAsync{T}"/>), the context the app itself reads it in.
/// No subscription: both plan fields null, never a made-up plan.</item>
/// <item>spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4): without <c>MayReadPhones</c> every owner phone is
/// <see cref="ControlRoomPhones.Hidden"/>; with it, a <c>phones_shown</c> History row naming the farms is written
/// BEFORE the answer is returned (a History failure sends no phone), only when a real phone is in the answer.</item>
/// <item>Above the ceiling, or when any farm could not be read (or could not be named), the list is not measured:
/// empty, with the reason, never a partial list that reads as "nobody else".</item>
/// </list>
/// <para><b>Nothing is caught.</b> A failed read escapes to the server's error path (500); an empty answer would
/// read as "no silent farm".</para>
/// </summary>
public sealed class GetSilentChurnHandler(
    ICompanyMisReader reader,
    IAdminMisRepository misRepo,
    ISubscriptionReader subscriptions,
    IControlRoomHistory history,
    IControlRoomStore controlRoomStore,
    DbContext db,
    CompanyMisExclusions exclusions,
    TimeProvider clock)
{
    public const string Band7To13 = "7-13";

    public const string Band14To29 = "14-29";

    public const string Band30Plus = "30+";

    public const string BandNever = "never";

    /// <summary>
    /// C10: entries are loaded from the start of the India day this many days before today, so every age under 30
    /// is exact; an older last entry is aged from the farm's all-time last entry.
    /// </summary>
    public const int LoadedDays = 30;

    public const string PlatformOnlyCode = "admin.platform_only";

    public async Task<Result<AdminResponseDto<SilentFarmsDto>>> HandleAsync(
        GetSilentChurnQuery query, CancellationToken ct = default)
    {
        if (!query.IsPlatformSeat)
        {
            return Result.Failure<AdminResponseDto<SilentFarmsDto>>(
                Error.Forbidden(PlatformOnlyCode, "This is for ShramSafal's own team only."));
        }

        var countedAtUtc = DateTime.SpecifyKind(clock.GetUtcNow().UtcDateTime, DateTimeKind.Utc);
        var today = GetCompanyMisHandler.IstDay(countedAtUtc);
        var sinceUtc = GetCompanyMisHandler.IstDayStartUtc(today.AddDays(-LoadedDays));

        var rows = await reader.ReadAsync(query.ActorId, sinceUtc, countedAtUtc, exclusions.UserIds, ct);

        // The Company MIS order: above the ceiling first, then an empty or partly unreadable farm list.
        if (rows.LiveCountSkipped)
        {
            return Answer(countedAtUtc, today, [], CompanyMisCalculator.TooManyFarmsForLiveCount);
        }

        if (rows.FarmsNotReadable > 0 || rows.FarmsListed == 0)
        {
            return Answer(countedAtUtc, today, [], CompanyMisCalculator.FarmListUnreadable);
        }

        var silent = SilentFarms(rows, exclusions.UserIds, countedAtUtc);
        if (silent.Count == 0)
        {
            return Answer(countedAtUtc, today, [], notMeasuredReason: null);
        }

        var contacts = (await misRepo.GetFarmContactsAsync(query.ActorId, silent.Select(s => s.FarmId).ToList(), ct))
            .ToDictionary(c => c.FarmId);

        // A listed farm the factory did not name (or that has no owner account) could not be read whole: the list
        // would be partial, so it is not measured, never sent with a blank name or a guessed plan.
        if (silent.Any(s => !contacts.TryGetValue(s.FarmId, out var c) || c.OwnerAccountId == Guid.Empty))
        {
            return Answer(countedAtUtc, today, [], CompanyMisCalculator.FarmListUnreadable);
        }

        var farms = new List<SilentFarmDto>(silent.Count);
        foreach (var farm in silent)
        {
            var contact = contacts[farm.FarmId];

            var plan = await RlsIdentityScope.RunAsFarmAsync(
                db, farm.FarmId, contact.OwnerAccountId, actorUserId: null,
                token => subscriptions.GetByOwnerAccountAsync(new OwnerAccountId(contact.OwnerAccountId), token),
                ct);

            farms.Add(new SilentFarmDto(
                FarmId: farm.FarmId,
                Name: contact.Name,
                OwnerPhone: query.MayReadPhones ? contact.OwnerPhone : ControlRoomPhones.Hidden,
                Band: farm.Band,
                DaysSilent: farm.DaysSilent,
                LastEntryUtc: farm.LastEntryUtc,
                PlanCode: plan?.PlanCode,
                PlanStatus: plan?.Status));
        }

        var ordered = farms
            .OrderBy(f => BandRank(f.Band))
            .ThenBy(f => f.DaysSilent ?? int.MaxValue)
            .ThenBy(f => f.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(f => f.FarmId)
            .ToList();

        // Without the tick no phone was sent. With it, the look is written to History BEFORE the answer is returned.
        if (query.MayReadPhones)
        {
            var withPhone = ordered.Where(f => ControlRoomPhones.IsReal(f.OwnerPhone)).Select(f => f.FarmId).ToList();
            if (withPhone.Count > 0)
            {
                await ControlRoomPhones.RecordLookAsync(
                    history, controlRoomStore, query.ActorId, query.AuditDeviceId, query.AuditIpHash,
                    "silent_farms", withPhone, personCount: 0, count: withPhone.Count, ct);
            }
        }

        return Answer(countedAtUtc, today, ordered, notMeasuredReason: null);
    }

    /// <summary>
    /// The silent farms in <paramref name="rows"/> as of the India day of <paramref name="countedAtUtc"/>, before
    /// naming. The farm set and the loaded entries are those Company MIS counts its bands from: farms owned by a test
    /// account are left out with everything on them, entries saved by a test account and rows at or after the
    /// counting instant are left out, farms registered by today only. Band by <see cref="BandOf"/>.
    /// </summary>
    internal static IReadOnlyList<SilentFarm> SilentFarms(
        CompanyMisRows rows, IReadOnlySet<Guid> excludedUserIds, DateTime countedAtUtc)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(excludedUserIds);

        var today = GetCompanyMisHandler.IstDay(countedAtUtc);

        var excludedFarms = rows.Farms
            .Where(f => excludedUserIds.Contains(f.OwnerUserId))
            .Select(f => f.FarmId)
            .ToHashSet();

        var entryDaysByFarm = rows.Entries
            .Where(e => !excludedFarms.Contains(e.FarmId)
                        && !excludedUserIds.Contains(e.OperatorUserId)
                        && e.CreatedAtUtc < countedAtUtc)
            .GroupBy(e => e.FarmId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(e => GetCompanyMisHandler.IstDay(e.CreatedAtUtc)).Distinct().Order().ToArray());

        var silent = new List<SilentFarm>();
        foreach (var farm in rows.Farms)
        {
            if (excludedFarms.Contains(farm.FarmId)
                || farm.CreatedAtUtc >= countedAtUtc
                || GetCompanyMisHandler.IstDay(farm.CreatedAtUtc) > today)
            {
                continue;
            }

            var age = CompanyMisCalculator.LastEntryAgeAt(
                entryDaysByFarm.TryGetValue(farm.FarmId, out var days) ? days : [],
                farm.FirstEntryUtc is { } first ? GetCompanyMisHandler.IstDay(first) : null,
                today);

            var band = BandOf(age);
            if (band is null)
            {
                continue;
            }

            // An age of int.MaxValue means "last entry before the loaded window": aged from the all-time last entry.
            int? daysSilent = age switch
            {
                null => null,
                int.MaxValue => farm.LastEntryUtc is { } last
                    ? today.DayNumber - GetCompanyMisHandler.IstDay(last).DayNumber
                    : null,
                _ => age,
            };

            silent.Add(new SilentFarm(farm.FarmId, band, daysSilent, age is null ? null : farm.LastEntryUtc));
        }

        return silent;
    }

    /// <summary>
    /// The band of a last-entry age (<see cref="CompanyMisCalculator.LastEntryAgeAt(DateOnly[], DateOnly?, DateOnly)"/>):
    /// never logged gives <see cref="BandNever"/>; 0 to 6 days gives null (active, not listed); 7 to 13, 14 to 29,
    /// and 30 or more (including <see cref="int.MaxValue"/>) give the Company MIS Retention bands.
    /// </summary>
    internal static string? BandOf(int? age) => age switch
    {
        null => BandNever,
        <= 6 => null,
        <= 13 => Band7To13,
        <= 29 => Band14To29,
        _ => Band30Plus,
    };

    private static int BandRank(string band) => band switch
    {
        Band7To13 => 0,
        Band14To29 => 1,
        Band30Plus => 2,
        _ => 3,
    };

    private static Result<AdminResponseDto<SilentFarmsDto>> Answer(
        DateTime countedAtUtc, DateOnly today, IReadOnlyList<SilentFarmDto> farms, string? notMeasuredReason) =>
        Result.Success(new AdminResponseDto<SilentFarmsDto>(
            new SilentFarmsDto(countedAtUtc, farms, notMeasuredReason),
            new AdminMetaDto(
                Source: "live",
                Window: today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                LastRefreshedUtc: countedAtUtc,
                TtlSeconds: 0)));

    /// <summary>A silent farm before naming: its band, India days silent, and all-time last entry.</summary>
    internal sealed record SilentFarm(Guid FarmId, string Band, int? DaysSilent, DateTime? LastEntryUtc);
}
