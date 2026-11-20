// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Identity;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomPeople;

/// <summary>
/// The founder approves a number. A number that is not an Indian mobile, one already on the list, one whose account
/// holds a Platform Owner seat (the founder is never added as a person), a role that does not parse (no "founder") and
/// an unknown tick are refused before anything is written. Omitted ticks mean NO ticks, never the role's preset. When an account already has the number it is bound at once
/// (H3): its existing non-owner Platform seat is reused, else an Employee seat is made. The person, the seat and the
/// <c>person_added</c> (+ <c>seat_bound</c>) History rows commit in ONE save. Nothing is texted (D2).
/// </summary>
public sealed class AddPersonHandler(IControlRoomStore store, IControlRoomPhoneDirectory directory, IClock clock)
{
    public async Task<Result<PersonDto>> HandleAsync(AddPersonCommand command, CancellationToken ct = default)
    {
        var phone = IndianMobile.Normalize(command.Phone);
        if (phone is null)
            return Result.Failure<PersonDto>(Error.Validation(ControlRoomPeopleCodes.PhoneInvalid, "Enter a 10-digit mobile number."));

        if (!ControlRoomRoles.TryParse(command.StartingRole, out var role))
            return Result.Failure<PersonDto>(PeopleCommon.RoleNotAllowed());

        // Presets are the console's prefill only (founder D-155c, H13): the server never fills ticks from a role.
        var ticks = command.Ticks ?? [];
        if (PeopleCommon.FirstUnknownTick(ticks) is { } unknown)
            return Result.Failure<PersonDto>(PeopleCommon.TickUnknown(unknown));

        if (await store.FindActiveByPhoneAsync(phone, ct) is not null)
            return Result.Failure<PersonDto>(Error.Conflict(ControlRoomPeopleCodes.AlreadyListed, "This number is already on the list."));

        var tenDigits = phone[3..];
        var account = await directory.FindByPhoneAsync(tenDigits, ct);
        OrganizationMembership? seat = null;
        if (account is not null)
        {
            seat = await store.ActivePlatformSeatOfAsync(account.UserId, ct);
            if (seat is { Role: OrganizationRole.Owner })
                return Result.Failure<PersonDto>(Error.Conflict(ControlRoomPeopleCodes.AlreadyFounder, "This number belongs to the founder."));
        }

        var now = clock.UtcNow;
        ControlRoomPerson person;
        try
        {
            person = ControlRoomPerson.Add(Guid.NewGuid(), phone, command.DisplayName ?? string.Empty, role, ticks, command.ActorId, now);
        }
        catch (ArgumentException e) when (e.ParamName == "displayName")
        {
            return Result.Failure<PersonDto>(PeopleCommon.NameInvalid());
        }

        store.Add(person);
        store.Record(PeopleCommon.Entry(
            ControlRoomHistoryAction.PersonAdded, command.ActorId, person.Id,
            new { role = ControlRoomRoles.Key(role), ticks = person.Ticks }, command.AuditDeviceId, command.AuditIpHash));

        if (account is not null)
        {
            if (seat is null)
            {
                var organizationId = await store.PlatformOrganizationIdAsync(ct);
                seat = OrganizationMembership.Create(
                    Guid.NewGuid(), organizationId, new UserId(account.UserId), OrganizationRole.Employee,
                    new UserId(command.ActorId), now);
                store.AddSeat(seat);
            }

            person.BindTo(account.UserId, seat.Id, now);
            store.Record(PeopleCommon.Entry(
                ControlRoomHistoryAction.SeatBound, command.ActorId, seat.Id,
                new { personId = person.Id }, command.AuditDeviceId, command.AuditIpHash));
        }

        await store.SaveChangesAsync(ct);
        return Result.Success(PeopleCommon.ToDto(person, account?.DisplayName, lastSignedInUtc: null));
    }
}
