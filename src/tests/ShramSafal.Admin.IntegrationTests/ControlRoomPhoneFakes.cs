// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4)
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Admin.IntegrationTests;

/// <summary>Records what the handlers write to History; throws on request, to prove a failed write sends no phone.</summary>
internal sealed class RecordingControlRoomHistory : IControlRoomHistory
{
    public List<ControlRoomHistoryEntry> Entries { get; } = [];

    public bool Throw { get; init; }

    public Task RecordNowAsync(ControlRoomHistoryEntry entry, CancellationToken ct)
    {
        if (Throw) throw new InvalidOperationException("History is unavailable.");
        Entries.Add(entry);
        return Task.CompletedTask;
    }

    public Task<HistoryRead> ReadAsync(
        Guid readerUserId, DateTime fromUtc, DateTime toUtc, string? action, int limit, CancellationToken ct) =>
        throw new NotSupportedException();

    public Task<IReadOnlyDictionary<Guid, DateTime>> LastSignedInAsync(
        Guid readerUserId, IReadOnlyCollection<Guid> userIds, CancellationToken ct) =>
        throw new NotSupportedException();
}

/// <summary>Answers only the person lookup the phone rule needs; <see cref="Person"/> null is a reader with no person row (the founder).</summary>
internal sealed class FixedControlRoomStore(ControlRoomPerson? person = null) : IControlRoomStore
{
    public Task<ControlRoomPerson?> FindActiveByUserAsync(Guid userId, CancellationToken ct) =>
        Task.FromResult(person);

    public Task<ControlRoomPerson?> FindActiveByPhoneAsync(string phoneE164, CancellationToken ct) => throw new NotSupportedException();
    public Task<ControlRoomPerson?> GetAsync(Guid personId, CancellationToken ct) => throw new NotSupportedException();
    public Task<IReadOnlyList<ControlRoomPerson>> ListActiveAsync(CancellationToken ct) => throw new NotSupportedException();
    public Task<Guid> PlatformOrganizationIdAsync(CancellationToken ct) => throw new NotSupportedException();
    public Task<IReadOnlyList<Guid>> PlatformOwnerUserIdsAsync(CancellationToken ct) => throw new NotSupportedException();
    public Task<OrganizationMembership?> ActivePlatformSeatOfAsync(Guid userId, CancellationToken ct) => throw new NotSupportedException();
    public void Add(ControlRoomPerson person) => throw new NotSupportedException();
    public void AddSeat(OrganizationMembership seat) => throw new NotSupportedException();
    public void Record(ControlRoomHistoryEntry entry) => throw new NotSupportedException();
    public Task SaveChangesAsync(CancellationToken ct) => throw new NotSupportedException();
}

internal static class ControlRoomPhoneFakesJson
{
    /// <summary>The <c>farmIds</c> of a <c>phones_shown</c> payload (an anonymous object).</summary>
    public static IReadOnlyList<Guid> FarmIds(object payload) =>
        System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(payload))
            .RootElement.GetProperty("farmIds").EnumerateArray().Select(e => e.GetGuid()).ToList();

    public static T Get<T>(object payload, string name) =>
        System.Text.Json.JsonSerializer.Deserialize<T>(
            System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(payload))
                .RootElement.GetProperty(name).GetRawText())!;
}
