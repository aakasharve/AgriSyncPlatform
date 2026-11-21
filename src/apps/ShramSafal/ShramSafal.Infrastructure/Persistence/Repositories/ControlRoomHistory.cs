// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A2)
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// History that is not committed with a data change (a refused number, a sign-in, a download) and the one way to read
/// it. Writes go through the request's context as <c>agrisync_app</c> (the NULL-farm branch of the audit table's
/// insert policy); reads go through <see cref="IAdminDbContextFactory{TContext}"/>, because the app role cannot read
/// other actors' farm-less rows, and every read leaves one <c>admin_cross_tenant</c> row naming the reader.
/// </summary>
internal sealed class ControlRoomHistory(
    ShramSafalDbContext db,
    IAdminDbContextFactory<ShramSafalDbContext> adminFactory) : IControlRoomHistory
{
    private const int MaxLimit = 1000;

    public async Task RecordNowAsync(ControlRoomHistoryEntry entry, CancellationToken ct)
    {
        db.AuditEvents.Add(ControlRoomHistoryRow.Build(entry));
        await db.SaveChangesAsync(ct);
    }

    public async Task<HistoryRead> ReadAsync(
        Guid readerUserId, DateTime fromUtc, DateTime toUtc, string? action, int limit, CancellationToken ct)
    {
        if (limit is < 1 or > MaxLimit)
            throw new ArgumentOutOfRangeException(nameof(limit), limit, $"The limit must be 1 to {MaxLimit}.");

        await using var admin = await adminFactory.CreateAsync("ControlRoomHistory.read", readerUserId, ct);

        var rows = admin.AuditEvents
            .AsNoTracking()
            .Where(a => a.EntityType == ControlRoomHistoryAction.EntityType
                && a.OccurredAtUtc >= fromUtc && a.OccurredAtUtc <= toUtc);
        if (!string.IsNullOrEmpty(action))
            rows = rows.Where(a => a.Action == action);

        var found = await rows
            .OrderByDescending(a => a.OccurredAtUtc).ThenByDescending(a => a.Id)
            .Take(limit)
            .Select(a => new { a.Id, a.OccurredAtUtc, a.Action, ActorUserId = a.ActorUserId, a.EntityId, a.Payload })
            .ToListAsync(ct);

        var lines = found
            .Select(a => new ControlRoomHistoryLine(a.Id, a.OccurredAtUtc, a.Action, a.ActorUserId.Value, a.EntityId, a.Payload))
            .ToList();
        return new HistoryRead(lines, lines.Count == limit);
    }

    public async Task<IReadOnlyDictionary<Guid, DateTime>> LastSignedInAsync(
        Guid readerUserId, IReadOnlyCollection<Guid> userIds, CancellationToken ct)
    {
        if (userIds.Count == 0) return new Dictionary<Guid, DateTime>();

        var wanted = userIds.Distinct().Select(id => new AgriSync.SharedKernel.Contracts.Ids.UserId(id)).ToList();
        await using var admin = await adminFactory.CreateAsync("ControlRoomHistory.lastSignedIn", readerUserId, ct);

        var found = await admin.AuditEvents
            .AsNoTracking()
            .Where(a => a.EntityType == ControlRoomHistoryAction.EntityType
                && a.Action == ControlRoomHistoryAction.SignedIn
                && wanted.Contains(a.ActorUserId))
            .GroupBy(a => a.ActorUserId)
            .Select(g => new { Actor = g.Key, At = g.Max(a => a.OccurredAtUtc) })
            .ToListAsync(ct);

        return found.ToDictionary(f => f.Actor.Value, f => f.At);
    }

    public async Task<DateTime?> FirstRecordedAtAsync(Guid readerUserId, CancellationToken ct)
    {
        await using var admin = await adminFactory.CreateAsync("ControlRoomHistory.firstRecorded", readerUserId, ct);
        return await admin.AuditEvents
            .AsNoTracking()
            .Where(a => a.EntityType == ControlRoomHistoryAction.EntityType)
            .MinAsync(a => (DateTime?)a.OccurredAtUtc, ct);
    }
}
