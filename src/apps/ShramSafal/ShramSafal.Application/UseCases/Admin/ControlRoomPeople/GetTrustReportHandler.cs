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

        var lastSignedIn = PeopleCommon.LastByActor(signedIn);
        var people = new List<TrustReportPerson>();
        foreach (var person in await store.ListActiveAsync(ct))
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
