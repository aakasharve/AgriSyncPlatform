// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomPeople;

/// <summary>
/// The founder changes a person's name, starting role or ticks. A field left out keeps its value. A role that does not
/// parse (no "founder") and an unknown tick are refused before anything changes. Records <c>person_changed</c> with the
/// ticks added and removed, and the role only when it changed; the change and its row commit in ONE save.
/// </summary>
public sealed class ChangePersonHandler(IControlRoomStore store, IClock clock)
{
    public async Task<Result<PersonDto>> HandleAsync(ChangePersonCommand command, CancellationToken ct = default)
    {
        var person = await store.GetAsync(command.PersonId, ct);
        if (person is null || !person.IsActive)
            return Result.Failure<PersonDto>(PeopleCommon.NotFound());

        var role = person.StartingRole;
        if (command.StartingRole is not null && !ControlRoomRoles.TryParse(command.StartingRole, out role))
            return Result.Failure<PersonDto>(PeopleCommon.RoleNotAllowed());

        var ticks = command.Ticks ?? person.Ticks.ToArray();
        if (PeopleCommon.FirstUnknownTick(ticks) is { } unknown)
            return Result.Failure<PersonDto>(PeopleCommon.TickUnknown(unknown));

        var roleChanged = role != person.StartingRole;
        TickChange change;
        try
        {
            change = person.Change(command.DisplayName ?? person.DisplayName, role, ticks, clock.UtcNow);
        }
        catch (ArgumentException e) when (e.ParamName == "displayName")
        {
            return Result.Failure<PersonDto>(PeopleCommon.NameInvalid());
        }

        object payload = roleChanged
            ? new { role = ControlRoomRoles.Key(role), added = change.Added, removed = change.Removed }
            : new { added = change.Added, removed = change.Removed };
        store.Record(PeopleCommon.Entry(
            ControlRoomHistoryAction.PersonChanged, command.ActorId, person.Id, payload,
            command.AuditDeviceId, command.AuditIpHash));

        await store.SaveChangesAsync(ct);
        return Result.Success(PeopleCommon.ToDto(person, boundAccountName: null, lastSignedInUtc: null));
    }
}
