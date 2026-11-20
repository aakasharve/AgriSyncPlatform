// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A2; D4)
using AgriSync.BuildingBlocks.Persistence;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.ControlRoom;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// The only place a <c>control_room</c> History row is built. <see cref="ControlRoomStore.Record"/> (committed with a
/// change) and <see cref="ControlRoomHistory.RecordNowAsync"/> (standing alone) both call it, so the two writers cannot
/// drift apart. <see cref="AuditEventFactory"/> refuses an empty subject id, so a caller that has no person to name
/// passes <c>SystemActor.ControlRoomDoor</c>; this builder never invents one.
/// </summary>
internal static class ControlRoomHistoryRow
{
    public static AuditEvent Build(ControlRoomHistoryEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        if (entry.SubjectId == Guid.Empty)
            throw new ArgumentException("A History row must name its subject.", nameof(entry));
        if (entry.ActorUserId == Guid.Empty)
            throw new ArgumentException("A History row must name who did it.", nameof(entry));
        ArgumentNullException.ThrowIfNull(entry.Payload);

        return AuditEventFactory.Create(
            entityType: ControlRoomHistoryAction.EntityType,
            entityId: entry.SubjectId,
            action: entry.Action,
            actorUserId: entry.ActorUserId,
            actorRole: ControlRoomHistoryAction.ActorRole,
            payload: entry.Payload,
            farmId: null,
            clientCommandId: null,
            appVersion: AppVersionProvider.Current,
            deviceId: entry.DeviceId,
            ipHash: entry.IpHash);
    }
}
