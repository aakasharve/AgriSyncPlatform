// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomPeople;

/// <summary>
/// The People page. The founder rows come first (an active Owner seat in the Platform organisation, named from the
/// account directory): <c>IsFounder</c>, every tick, no id and so no actions. Then the approved people, oldest first, each
/// with the name of the account their number is bound to and when they last signed in. "Last signed in" comes from one
/// read of <c>signed_in</c> History over the last 90 days; a person with no row in it has <c>null</c>, never a made-up date.
/// </summary>
public sealed class ListPeopleHandler(
    IControlRoomStore store, IControlRoomPhoneDirectory directory, IControlRoomHistory history, IClock clock)
{
    private const int LastSignInWindowDays = 90;
    private const int ReadLimit = 1000;

    public async Task<PeopleAnswerDto> HandleAsync(Guid readerUserId, CancellationToken ct = default)
    {
        var now = DateTime.SpecifyKind(clock.UtcNow, DateTimeKind.Utc);
        var signIns = await history.ReadAsync(
            readerUserId, now.AddDays(-LastSignInWindowDays), now.AddMinutes(1),
            ControlRoomHistoryAction.SignedIn, ReadLimit, ct);
        var lastSignedIn = PeopleCommon.LastByActor(signIns);

        var allTicks = ControlRoomTicks.All.Select(t => t.Key).ToList();
        var rows = new List<PersonDto>();

        foreach (var founderId in await store.PlatformOwnerUserIdsAsync(ct))
        {
            var account = await directory.FindByUserAsync(founderId, ct);
            rows.Add(new PersonDto(
                null, true, account?.DisplayName ?? "Founder", account?.TenDigitPhone ?? string.Empty, "founder", allTicks,
                null, lastSignedIn.TryGetValue(founderId, out var at) ? at : null, null));
        }

        foreach (var person in await store.ListActiveAsync(ct))
        {
            string? boundName = null;
            DateTime? last = null;
            if (person.UserId is { } userId)
            {
                boundName = (await directory.FindByUserAsync(userId, ct))?.DisplayName;
                last = lastSignedIn.TryGetValue(userId, out var seen) ? seen : null;
            }

            rows.Add(PeopleCommon.ToDto(person, boundName, last));
        }

        var presets = Enum.GetValues<ControlRoomRole>()
            .ToDictionary(r => ControlRoomRoles.Key(r), r => ControlRoomRoles.PresetTicks(r));

        return new PeopleAnswerDto(
            rows,
            ControlRoomTicks.All.Select(t => new TickInfoDto(t.Key, t.IsPersonalData)).ToList(),
            presets);
    }
}
