// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomPeople;

/// <summary>
/// The People page. The founder rows come first (an active Owner seat in the Platform organisation, named from the
/// account directory): <c>IsFounder</c>, every tick, no id and so no actions. Then the approved people, oldest first, each
/// with the name of the account their number is bound to and when they last signed in. "Last signed in" comes from
/// <see cref="IControlRoomHistory.LastSignedInAsync"/> (no window, no cap); only a person with no <c>signed_in</c> row at
/// all has <c>null</c>, which the console says as "Not signed in yet". Never a made-up date, never a false "never".
/// </summary>
public sealed class ListPeopleHandler(
    IControlRoomStore store, IControlRoomPhoneDirectory directory, IControlRoomHistory history)
{
    public async Task<PeopleAnswerDto> HandleAsync(Guid readerUserId, CancellationToken ct = default)
    {
        var founderIds = await store.PlatformOwnerUserIdsAsync(ct);
        var people = await store.ListActiveAsync(ct);
        var listedUsers = founderIds.Concat(people.Where(p => p.UserId is not null).Select(p => p.UserId!.Value)).ToList();
        var lastSignedIn = await history.LastSignedInAsync(readerUserId, listedUsers, ct);

        var allTicks = ControlRoomTicks.All.Select(t => t.Key).ToList();
        var rows = new List<PersonDto>();

        foreach (var founderId in founderIds)
        {
            var account = await directory.FindByUserAsync(founderId, ct);
            rows.Add(new PersonDto(
                null, true, account?.DisplayName ?? "Founder", account?.TenDigitPhone ?? string.Empty, "founder", allTicks,
                null, lastSignedIn.TryGetValue(founderId, out var at) ? at : null, null));
        }

        foreach (var person in people)
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
