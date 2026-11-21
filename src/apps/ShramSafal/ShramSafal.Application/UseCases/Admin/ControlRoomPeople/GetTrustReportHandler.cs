// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Domain.ControlRoom;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomPeople;

/// <summary>
/// The weekly trust report (K15). One History read per action, never one capped read for everything:
/// <c>phones_shown</c> and <c>door_refused</c> over the last 7 days, <c>signed_in</c> and <c>person_kept</c> over the last
/// 30. <see cref="TrustReportCalculator"/> turns the reads into numbers (a read that hit its limit is "not measured").
/// <para>
/// G1 fix round 1 (M9): test accounts are the Company MIS list (<see cref="CompanyMisExclusions"/>,
/// <c>CompanyMis:ExcludedUserIds</c>); a test farm is a farm one of them owns. The owners of the farms the phone looks
/// name are read once, through the audited cross-farm read, and only when there is a test account to find and a
/// measured look naming a farm; otherwise nothing cross-farm is opened. A failed read is not caught (500).
/// Fix wave S-N1: the list is used only to find test FARMS; a look is never left out because of who looked (staff are
/// on the list for Company MIS, and every looker is staff). Fix wave S-N2: the time History began is read once.
/// </para>
/// </summary>
public sealed class GetTrustReportHandler(
    IControlRoomStore store, IControlRoomPhoneDirectory directory, IControlRoomHistory history,
    IAdminMisRepository misRepo, CompanyMisExclusions exclusions, IClock clock)
{
    private const int ReadLimit = 1000;

    public async Task<TrustReportDto> HandleAsync(Guid readerUserId, CancellationToken ct = default)
    {
        var now = DateTime.SpecifyKind(clock.UtcNow, DateTimeKind.Utc);
        var to = now + TrustReportCalculator.ReadSlack;
        var week = now.AddDays(-TrustReportCalculator.ShortWindowDays);
        var month = now.AddDays(-TrustReportCalculator.LongWindowDays);

        var historyStartedAt = await history.FirstRecordedAtAsync(readerUserId, ct);
        var phones = await history.ReadAsync(readerUserId, week, to, ControlRoomHistoryAction.PhonesShown, ReadLimit, ct);
        var refused = await history.ReadAsync(readerUserId, week, to, ControlRoomHistoryAction.DoorRefused, ReadLimit, ct);
        var signedIn = await history.ReadAsync(readerUserId, month, to, ControlRoomHistoryAction.SignedIn, ReadLimit, ct);
        var kept = await history.ReadAsync(readerUserId, month, to, ControlRoomHistoryAction.PersonKept, ReadLimit, ct);

        // Who is listed as unused is decided by the 30-day read (K15); the date shown is the true last sign-in.
        var active = await store.ListActiveAsync(ct);
        var lastSignedIn = await history.LastSignedInAsync(
            readerUserId, active.Where(p => p.UserId is not null).Select(p => p.UserId!.Value).ToList(), ct);
        var people = new List<TrustReportPerson>();
        foreach (var person in active)
        {
            string? boundName = null;
            DateTime? last = null;
            if (person.UserId is { } userId)
            {
                boundName = (await directory.FindByUserAsync(userId, ct))?.DisplayName;
                last = lastSignedIn.TryGetValue(userId, out var seen) ? seen : null;
            }

            people.Add(new TrustReportPerson(person, PeopleCommon.ToDto(person, boundName, last)));
        }

        var founders = (await store.PlatformOwnerUserIdsAsync(ct)).Count;
        var testFarms = await TestFarmsAsync(readerUserId, phones, ct);
        return TrustReportCalculator.Calculate(new TrustReportInput(
            now, people, founders, phones, refused, signedIn, kept, testFarms, historyStartedAt));
    }

    /// <summary>The farms named by the phone looks whose owner is a test account.</summary>
    private async Task<IReadOnlySet<Guid>> TestFarmsAsync(Guid readerUserId, HistoryRead phones, CancellationToken ct)
    {
        if (exclusions.UserIds.Count == 0 || phones.HitLimit)
            return new HashSet<Guid>();

        var farmIds = TrustReportCalculator.FarmIdsIn(phones);
        if (farmIds.Count == 0)
            return new HashSet<Guid>();

        var owners = await misRepo.GetFarmOwnersAsync(readerUserId, farmIds, ct);
        return owners.Where(o => exclusions.UserIds.Contains(o.Value)).Select(o => o.Key).ToHashSet();
    }
}
