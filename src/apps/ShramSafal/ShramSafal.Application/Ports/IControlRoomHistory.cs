// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A2)
namespace ShramSafal.Application.Ports;

/// <summary>One History line as the console shows it. <see cref="PayloadJson"/> is the row's payload as stored.</summary>
public sealed record ControlRoomHistoryLine(
    Guid Id,
    DateTime AtUtc,
    string Action,
    Guid ActorUserId,
    Guid SubjectId,
    string PayloadJson);

/// <summary>
/// <see cref="HitLimit"/> is true when exactly <c>limit</c> rows came back, so a caller never treats a cut list
/// as the whole (K15). A count read that hits the limit is reported as not measured, never as the cut number.
/// </summary>
public sealed record HistoryRead(IReadOnlyList<ControlRoomHistoryLine> Lines, bool HitLimit);

/// <summary>History that stands on its own (not committed with a data change) and the one audited way to read it.</summary>
public interface IControlRoomHistory
{
    /// <summary>Writes one History row and saves it now.</summary>
    Task RecordNowAsync(ControlRoomHistoryEntry entry, CancellationToken ct);

    /// <summary>
    /// Reads <c>control_room</c> rows in the window across all actors, newest first, at most <paramref name="limit"/> (1..1000).
    /// Opens the audited cross-tenant factory as <paramref name="readerUserId"/>: one <c>admin_cross_tenant</c> row per read.
    /// </summary>
    Task<HistoryRead> ReadAsync(Guid readerUserId, DateTime fromUtc, DateTime toUtc, string? action, int limit, CancellationToken ct);

    /// <summary>
    /// The newest <c>signed_in</c> time of each of <paramref name="userIds"/> (a person with no <c>signed_in</c> row is
    /// absent): one grouped query with no window and no row cap, so a date is true however old it is and however many
    /// sign-ins came since. Opens the audited cross-tenant factory as <paramref name="readerUserId"/>; with no ids it
    /// opens nothing.
    /// </summary>
    Task<IReadOnlyDictionary<Guid, DateTime>> LastSignedInAsync(
        Guid readerUserId, IReadOnlyCollection<Guid> userIds, CancellationToken ct);
}
