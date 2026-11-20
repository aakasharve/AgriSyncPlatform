// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A6)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Identity;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomDoor;

/// <summary>
/// Lock 1, the console door: who may be sent a control-room code, and the History rows of the door.
/// <list type="bullet">
/// <item><b>Approved</b> = an active person with that number whose bound account, if any, still holds it; or a number whose
/// account holds the Platform Owner seat (the founder, who has no person row, H2). Everything else is not approved.</item>
/// <item>A refused try is written as <c>door_refused</c> with the LAST FOUR digits only: no full number and no hash of it
/// of any kind (AM1: an unsalted hash prefix plus the last four recovers the whole number, and History is never erased).</item>
/// <item>A sign-in is written as <c>signed_in</c> by the account that signed in, and an unbound person is bound to that
/// account in the same save (H3): its existing non-owner Platform seat is reused, else an Employee seat is made.</item>
/// </list>
/// This class never texts and never runs a User handler (E2): the routes that do live in the host.
/// </summary>
public sealed class ControlRoomDoor(
    IControlRoomStore store,
    IControlRoomHistory history,
    IControlRoomPhoneDirectory directory,
    IEntitlementResolver resolver,
    IClock clock)
{
    /// <summary>
    /// Both door routes hold every answer until this long after the request began (H14), so an approved number, a refused
    /// one and one the SMS limit would refuse take the same time. The routes wait on an injected <see cref="TimeProvider"/>.
    /// </summary>
    public static readonly TimeSpan AnswerFloor = TimeSpan.FromSeconds(2);

    public const string StepSend = "send";
    public const string StepCheck = "check";
    public const string ReasonNotListed = "not_listed";
    public const string ReasonAccountChanged = "account_changed";

    public async Task<DoorDecision> DecideAsync(string? typedPhone, CancellationToken ct)
    {
        var phone = IndianMobile.Normalize(typedPhone);
        if (phone is null)
            return new DoorDecision(DoorOutcome.InvalidPhone, null, null, null, IsFounder: false, RefusalReason: null);

        var tenDigits = phone[3..];
        var person = await store.FindActiveByPhoneAsync(phone, ct);
        if (person is not null)
        {
            if (person.UserId is { } boundTo)
            {
                // H3: bound to account X, but the number now belongs to account Y (or to nobody): refused.
                var holder = await directory.FindByPhoneAsync(tenDigits, ct);
                if (holder?.UserId != boundTo)
                    return Refused(phone, tenDigits, person, ReasonAccountChanged);
            }

            return new DoorDecision(DoorOutcome.Approved, phone, tenDigits, person, IsFounder: false, RefusalReason: null);
        }

        var account = await directory.FindByPhoneAsync(tenDigits, ct);
        if (account is not null && await resolver.IsPlatformOwnerAsync(new UserId(account.UserId), ct))
            return new DoorDecision(DoorOutcome.Approved, phone, tenDigits, null, IsFounder: true, RefusalReason: null);

        return Refused(phone, tenDigits, null, ReasonNotListed);
    }

    /// <summary>One <c>door_refused</c> row: <c>{ step, phoneTail, reason }</c>, by the door, about the matched person or the door.</summary>
    public Task RecordRefusedAsync(DoorDecision d, string step, string deviceId, string ipHash, CancellationToken ct)
    {
        if (d.Outcome != DoorOutcome.NotApproved || d.PhoneE164 is null)
            throw new InvalidOperationException("Only a refused number is recorded as refused.");
        if (step is not (StepSend or StepCheck))
            throw new ArgumentException("The step is 'send' or 'check'.", nameof(step));

        return history.RecordNowAsync(new ControlRoomHistoryEntry(
            ControlRoomHistoryAction.DoorRefused,
            SystemActor.ControlRoomDoor,
            SubjectOf(d),
            new { step, phoneTail = IndianMobile.Tail(d.PhoneE164), reason = d.RefusalReason },
            deviceId,
            ipHash), ct);
    }

    /// <summary>
    /// <c>signed_in</c> by <paramref name="userId"/> (the People page groups sign-ins by who signed in). An unbound person is
    /// bound to that account first (H3), with its <c>seat_bound</c> row; the bind and both rows commit in ONE save, so a
    /// failure leaves nothing half-granted and throws (the route answers 500 and hands out no token, K26).
    /// </summary>
    public async Task RecordSignedInAsync(
        DoorDecision d, Guid userId, bool heldForQuestion, string deviceId, string ipHash, CancellationToken ct)
    {
        if (d.Outcome != DoorOutcome.Approved)
            throw new InvalidOperationException("Only an approved number signs in.");
        if (userId == Guid.Empty)
            throw new ArgumentException("The account that signed in is required.", nameof(userId));

        var person = d.Person;
        if (person is not null && person.UserId is null)
        {
            var seat = await store.ActivePlatformSeatOfAsync(userId, ct);
            if (seat is { Role: OrganizationRole.Owner })
                throw new InvalidOperationException("A listed person is never bound to a Platform Owner seat.");

            var now = clock.UtcNow;
            if (seat is null)
            {
                var organizationId = await store.PlatformOrganizationIdAsync(ct);
                seat = OrganizationMembership.Create(
                    Guid.NewGuid(), organizationId, new UserId(userId), OrganizationRole.Employee,
                    new UserId(person.AddedByUserId), now);
                store.AddSeat(seat);
            }

            person.BindTo(userId, seat.Id, now);
            store.Record(new ControlRoomHistoryEntry(
                ControlRoomHistoryAction.SeatBound, userId, seat.Id, new { personId = person.Id }, deviceId, ipHash));
        }
        else if (person is not null && person.UserId != userId)
        {
            // The decision saw this account holding the number; a different one signing in means it changed under us.
            throw new InvalidOperationException("The number now belongs to a different account.");
        }

        store.Record(new ControlRoomHistoryEntry(
            ControlRoomHistoryAction.SignedIn, userId, person?.Id ?? userId, new { heldForQuestion }, deviceId, ipHash));
        await store.SaveChangesAsync(ct);
    }

    /// <summary>K10: the matched person, else the door itself (the founder's own sign-in names him in <see cref="RecordSignedInAsync"/>).</summary>
    public static Guid SubjectOf(DoorDecision d) => d.Person?.Id ?? SystemActor.ControlRoomDoor;

    /// <summary>
    /// The <c>code_not_sent</c> row (AM2): <c>{ phoneTail, reason }</c> by the door. The reason is an error code or an
    /// exception's type name: never the number, never a hash of it, never a message that could quote one.
    /// </summary>
    public static ControlRoomHistoryEntry CodeNotSent(Guid subjectId, string phoneTail, string reason, string deviceId, string ipHash) =>
        new(ControlRoomHistoryAction.CodeNotSent, SystemActor.ControlRoomDoor, subjectId, new { phoneTail, reason }, deviceId, ipHash);

    private static DoorDecision Refused(string phone, string tenDigits, ControlRoomPerson? person, string reason) =>
        new(DoorOutcome.NotApproved, phone, tenDigits, person, IsFounder: false, RefusalReason: reason);
}
