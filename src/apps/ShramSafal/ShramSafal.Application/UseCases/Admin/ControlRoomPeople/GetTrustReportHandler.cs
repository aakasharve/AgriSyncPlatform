// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomPeople;

/// <summary>
/// The weekly trust report (K15). One History read per action, never one capped read for everything:
/// <c>phones_shown</c> and <c>door_refused</c> over the last 7 days, <c>signed_in</c> and <c>person_kept</c> over the last
/// 30. <see cref="TrustReportCalculator"/> turns the reads into numbers (a read that hit its limit is "not measured").
/// </summary>
public sealed class GetTrustReportHandler(
    IControlRoomStore store, IControlRoomPhoneDirectory directory, IControlRoomHistory history, IClock clock)
{
    private const int ReadLimit = 1000;

    public async Task<TrustReportDto> HandleAsync(Guid readerUserId, CancellationToken ct = default)
    {
        var now = DateTime.SpecifyKind(clock.UtcNow, DateTimeKind.Utc);
        var to = now.AddMinutes(1);
        var week = now.AddDays(-TrustReportCalculator.ShortWindowDays);
        var month = now.AddDays(-TrustReportCalculator.LongWindowDays);

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
        return TrustReportCalculator.Calculate(new TrustReportInput(now, people, founders, phones, refused, signedIn, kept));
    }
}
