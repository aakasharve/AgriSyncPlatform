// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4)
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Application.Admin;

/// <summary>
/// The one rule for farmers' phone numbers in the control room: a phone is sent only to a seat holding the
/// <c>farmer_phones</c> tick (module <see cref="ModuleKey.FarmsPhones"/>) or to the founder, and every answer that
/// really carries a phone is written to History before it is returned.
/// </summary>
public static class ControlRoomPhones
{
    /// <summary>What a phone field holds for a seat without the tick; the console shows it as "Hidden for you".</summary>
    public const string Hidden = "**redacted**";

    public static bool MayRead(AdminScope scope) =>
        scope.IsPlatformAdmin || scope.CanRead(ModuleKey.FarmsPhones);

    /// <summary>A phone that is null, blank or the "no phone on record" dash is not a real phone.</summary>
    public static bool IsReal(string? phone) =>
        !string.IsNullOrWhiteSpace(phone) && phone.Trim() != "—";

    /// <summary>
    /// Writes one <c>phones_shown</c> row (and saves it now) BEFORE the caller returns the answer, so a History
    /// failure sends no phone. The subject is the reader's active person id, else the reader's own user id (the
    /// founder has no person row). Call it only when at least one real phone is in the answer, from a read-only
    /// handler with nothing else pending on the request's context.
    /// </summary>
    public static async Task RecordLookAsync(
        IControlRoomHistory history,
        IControlRoomStore store,
        Guid actorId,
        string auditDeviceId,
        string auditIpHash,
        string page,
        IReadOnlyCollection<Guid>? farmIds,
        int personCount,
        int count,
        CancellationToken ct)
    {
        var person = await store.FindActiveByUserAsync(actorId, ct);
        var subjectId = person?.Id ?? actorId;

        object payload = farmIds is null
            ? new { page, personCount, count }
            : new { page, farmIds, count };

        await history.RecordNowAsync(
            new ControlRoomHistoryEntry(
                ControlRoomHistoryAction.PhonesShown, actorId, subjectId, payload, auditDeviceId, auditIpHash),
            ct);
    }
}
