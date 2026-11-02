// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-36)
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Consent;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Privacy;

/// <summary>
/// EF store for <c>ssf.improvement_permission_events</c>. Every read and write runs as
/// the person the rows belong to (<see cref="ICallerUserTenantScope"/>): the table is
/// ENABLE + FORCE row-level secured with a self-only policy, so a session without that
/// identity sees nothing and cannot write. The explicit <c>user_id</c> predicate is
/// defence in depth.
/// </summary>
internal sealed class ImprovementPermissionStore(
    ShramSafalDbContext db,
    ICallerUserTenantScope userScope) : IImprovementPermissionStore
{
    public Task<ImprovementPermissionEvent?> GetLatestAsync(Guid userId, CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
        {
            return Task.FromResult<ImprovementPermissionEvent?>(null);
        }

        // Newest first. Two rows at the same instant: the OFF wins (false sorts first) — a
        // tie must never resolve towards using his data.
        return userScope.RunForCallerAsync(
            userId,
            token => db.ImprovementPermissionEvents
                .AsNoTracking()
                .Where(e => e.UserId == userId)
                .OrderByDescending(e => e.ChosenAtUtc)
                .ThenBy(e => e.Allowed)
                .FirstOrDefaultAsync(token),
            ct);
    }

    public Task<bool> IsAccountErasureRequestedAsync(Guid userId, CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
        {
            return Task.FromResult(true); // not an identity: never a licence
        }

        // ErasureRequest.TargetUserId = OnBehalfOfUserId ?? RequestedByUserId, spelled out so
        // EF can translate it. Any status counts — even a failed erasure was asked for, and one still
        // WAITING its 30 days (D-71) counts from the moment it is asked. Except a CANCELLED one
        // (lane F99 fix pass 1, item 11): he took it back before anything was erased, so it asks nothing.
        return userScope.RunForCallerAsync(
            userId,
            token => db.ErasureRequests
                .AsNoTracking()
                .AnyAsync(r => r.Status != ShramSafal.Domain.Privacy.ErasureStatus.Cancelled
                    && (r.OnBehalfOfUserId == userId
                        || (r.OnBehalfOfUserId == null && r.RequestedByUserId == userId)), token),
            ct);
    }

    public Task AppendAsync(ImprovementPermissionEvent choice, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(choice);
        return userScope.RunForCallerAsync<object?>(
            choice.UserId,
            async token =>
            {
                await db.ImprovementPermissionEvents.AddAsync(choice, token);
                await db.SaveChangesAsync(token);
                return null;
            },
            ct);
    }
}
