// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomPeople;

/// <summary>What the people handlers share: the person row, the role and tick rules, the History row.</summary>
internal static class PeopleCommon
{
    public static PersonDto ToDto(ControlRoomPerson p, string? boundAccountName, DateTime? lastSignedInUtc) =>
        new(p.Id, false, p.DisplayName, p.PhoneE164[3..], ControlRoomRoles.Key(p.StartingRole), p.Ticks,
            boundAccountName, lastSignedInUtc, p.KeptAtUtc);

    public static Error RoleNotAllowed() =>
        Error.Validation(ControlRoomPeopleCodes.RoleNotAllowed, "Choose Admin, Field operator or Viewer.");

    public static Error TickUnknown(string tick) =>
        Error.Validation(
            ControlRoomPeopleCodes.TickUnknown,
            string.IsNullOrWhiteSpace(tick)
                ? "An empty tick is not a part the control room knows."
                : $"'{tick}' is not a part the control room knows.");

    public static Error NameInvalid() =>
        Error.Validation(ControlRoomPeopleCodes.NameInvalid, "Give the person's name, 1 to 80 characters.");

    public static Error NotFound() =>
        Error.NotFound(ControlRoomPeopleCodes.PersonNotFound, "That person is not on the list.");

    /// <summary>
    /// The first tick key that is not known, or null when every one is. A null or blank entry is not known: it comes back
    /// as "" (a null), or as itself, so it is refused as <c>tick_unknown</c> (G1 fix round 1, M1). Before, a null entry was
    /// indistinguishable from "every tick is known", reached the domain and answered 500.
    /// </summary>
    public static string? FirstUnknownTick(IEnumerable<string?> ticks)
    {
        foreach (var tick in ticks)
        {
            if (tick is null || !ControlRoomTicks.IsKnown(tick))
                return tick ?? string.Empty;
        }

        return null;
    }

    public static ControlRoomHistoryEntry Entry(
        string action, Guid actorId, Guid subjectId, object payload, string deviceId, string ipHash) =>
        new(action, actorId, subjectId, payload, deviceId, ipHash);
}
