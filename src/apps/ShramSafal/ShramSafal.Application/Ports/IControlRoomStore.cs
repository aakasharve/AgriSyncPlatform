// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A2)
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Application.Ports;

/// <summary>
/// One row of History to write: the control room's own trail in <c>ssf.audit_events</c>
/// (<c>entity_type = "control_room"</c>, no farm). <see cref="SubjectId"/> is never <see cref="Guid.Empty"/>:
/// the person's id for a person row, the membership id for <c>seat_bound</c>, the visit id for <c>visit_done</c>,
/// and <c>SystemActor.ControlRoomDoor</c> when no person matched the number.
/// </summary>
public sealed record ControlRoomHistoryEntry(
    string Action,
    Guid ActorUserId,
    Guid SubjectId,
    object Payload,
    string DeviceId,
    string IpHash);

/// <summary>
/// The approved-numbers list and the platform seats it binds to. A change and its History row commit in one
/// <see cref="SaveChangesAsync"/> (<see cref="Record"/> adds to the same context; nothing is saved by it).
/// </summary>
public interface IControlRoomStore
{
    Task<ControlRoomPerson?> FindActiveByPhoneAsync(string phoneE164, CancellationToken ct);

    Task<ControlRoomPerson?> FindActiveByUserAsync(Guid userId, CancellationToken ct);

    Task<ControlRoomPerson?> GetAsync(Guid personId, CancellationToken ct);

    /// <summary>Active people, oldest first.</summary>
    Task<IReadOnlyList<ControlRoomPerson>> ListActiveAsync(CancellationToken ct);

    /// <summary>The one active organisation of type Platform (found by its type, never by an id). Throws when there is none or more than one.</summary>
    Task<Guid> PlatformOrganizationIdAsync(CancellationToken ct);

    /// <summary>Users who hold an active Owner seat in an active Platform organisation.</summary>
    Task<IReadOnlyList<Guid>> PlatformOwnerUserIdsAsync(CancellationToken ct);

    /// <summary>The user's active seat in an active Platform organisation, or null.</summary>
    Task<OrganizationMembership?> ActivePlatformSeatOfAsync(Guid userId, CancellationToken ct);

    void Add(ControlRoomPerson person);

    void AddSeat(OrganizationMembership seat);

    /// <summary>Adds the History row to the same unit of work as the change it records.</summary>
    void Record(ControlRoomHistoryEntry entry);

    Task SaveChangesAsync(CancellationToken ct);
}
