// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomPeople;

/// <summary>The founder's "still needed" mark: sets <c>KeptAtUtc</c> and records <c>person_kept</c> in ONE save. It changes no access.</summary>
public sealed class KeepPersonHandler(IControlRoomStore store, IClock clock)
{
    public async Task<Result<PersonDto>> HandleAsync(KeepPersonCommand command, CancellationToken ct = default)
    {
        var person = await store.GetAsync(command.PersonId, ct);
        if (person is null || !person.IsActive)
            return Result.Failure<PersonDto>(PeopleCommon.NotFound());

        person.Keep(clock.UtcNow);
        store.Record(PeopleCommon.Entry(
            ControlRoomHistoryAction.PersonKept, command.ActorId, person.Id, new { },
            command.AuditDeviceId, command.AuditIpHash));

        await store.SaveChangesAsync(ct);
        return Result.Success(PeopleCommon.ToDto(person, boundAccountName: null, lastSignedInUtc: null));
    }
}
