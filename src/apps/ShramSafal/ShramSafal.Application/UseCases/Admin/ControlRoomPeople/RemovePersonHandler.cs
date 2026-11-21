// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomPeople;

/// <summary>
/// The founder removes a person. "A removed person is refused from the next request": the resolver refuses a person
/// only because the seat is gone, so the person's Platform seat is deactivated in the same save (an Owner seat is never
/// touched, whatever the row says). Records <c>person_removed</c>; the removal, the seat and the row commit in ONE save.
/// <para>
/// Fix wave S-A4 (AU-M1): the person's console sessions (refresh credentials born at the door) are ended first, so a
/// person removed and later added back never gets an old session, on a lost or shared laptop, back without a new code.
/// They live in the User module, so they are ended through <see cref="IControlRoomDoorSessions"/> before the removal is
/// saved: if ending them fails nothing is removed (the founder tries again), and if the removal then fails the person
/// is only signed out of the console. Farmer-app sessions of the same account are never touched.
/// </para>
/// </summary>
public sealed class RemovePersonHandler(IControlRoomStore store, IClock clock, IControlRoomDoorSessions doorSessions)
{
    public async Task<Result<PersonDto>> HandleAsync(RemovePersonCommand command, CancellationToken ct = default)
    {
        var person = await store.GetAsync(command.PersonId, ct);
        if (person is null || !person.IsActive)
            return Result.Failure<PersonDto>(PeopleCommon.NotFound());

        var now = clock.UtcNow;
        if (person.UserId is { } boundAccount)
        {
            await doorSessions.EndDoorSessionsAsync(boundAccount, now, ct);
        }

        person.Remove(command.ActorId, now);

        if (person.UserId is { } userId
            && await store.ActivePlatformSeatOfAsync(userId, ct) is { } seat
            && seat.Role != OrganizationRole.Owner)
        {
            seat.Deactivate(new UserId(command.ActorId), now);
        }

        store.Record(PeopleCommon.Entry(
            ControlRoomHistoryAction.PersonRemoved, command.ActorId, person.Id, new { },
            command.AuditDeviceId, command.AuditIpHash));

        await store.SaveChangesAsync(ct);
        return Result.Success(PeopleCommon.ToDto(person, boundAccountName: null, lastSignedInUtc: null));
    }
}
