// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A2)
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// The approved-numbers list over the request's own <see cref="ShramSafalDbContext"/>. A change, a seat and the History
/// row that records them are tracked on this one context and written by one <see cref="SaveChangesAsync"/>.
/// The Platform organisation is found by its type, exactly as <c>EntitlementResolver.IsPlatformOwnerAsync</c> does;
/// no id of it is named here.
/// </summary>
internal sealed class ControlRoomStore(ShramSafalDbContext db) : IControlRoomStore
{
    public Task<ControlRoomPerson?> FindActiveByPhoneAsync(string phoneE164, CancellationToken ct) =>
        db.ControlRoomPeople.FirstOrDefaultAsync(p => p.PhoneE164 == phoneE164 && p.IsActive, ct);

    public Task<ControlRoomPerson?> FindActiveByUserAsync(Guid userId, CancellationToken ct) =>
        db.ControlRoomPeople.FirstOrDefaultAsync(p => p.UserId == userId && p.IsActive, ct);

    public Task<ControlRoomPerson?> GetAsync(Guid personId, CancellationToken ct) =>
        db.ControlRoomPeople.FirstOrDefaultAsync(p => p.Id == personId, ct);

    public async Task<IReadOnlyList<ControlRoomPerson>> ListActiveAsync(CancellationToken ct) =>
        await db.ControlRoomPeople
            .Where(p => p.IsActive)
            .OrderBy(p => p.AddedAtUtc).ThenBy(p => p.Id)
            .ToListAsync(ct);

    public async Task<Guid> PlatformOrganizationIdAsync(CancellationToken ct)
    {
        var ids = await db.Organizations
            .Where(o => o.IsActive && o.Type == OrganizationType.Platform)
            .Select(o => o.Id)
            .Take(2)
            .ToListAsync(ct);

        return ids.Count switch
        {
            1 => ids[0],
            0 => throw new InvalidOperationException("There is no active Platform organisation."),
            _ => throw new InvalidOperationException("There is more than one active Platform organisation."),
        };
    }

    public async Task<IReadOnlyList<Guid>> PlatformOwnerUserIdsAsync(CancellationToken ct)
    {
        var owners = await (
            from m in db.OrganizationMemberships
            join o in db.Organizations on m.OrganizationId equals o.Id
            where m.IsActive && o.IsActive
                && o.Type == OrganizationType.Platform && m.Role == OrganizationRole.Owner
            select m.UserId)
            .Distinct()
            .ToListAsync(ct);
        return owners.Select(u => u.Value).ToList();
    }

    public async Task<OrganizationMembership?> ActivePlatformSeatOfAsync(Guid userId, CancellationToken ct)
    {
        var user = new UserId(userId);
        return await (
            from m in db.OrganizationMemberships
            join o in db.Organizations on m.OrganizationId equals o.Id
            where m.UserId == user && m.IsActive && o.IsActive && o.Type == OrganizationType.Platform
            orderby m.JoinedAtUtc, m.Id
            select m)
            .FirstOrDefaultAsync(ct);
    }

    public void Add(ControlRoomPerson person) => db.ControlRoomPeople.Add(person);

    public void AddSeat(OrganizationMembership seat) => db.OrganizationMemberships.Add(seat);

    public void Record(ControlRoomHistoryEntry entry) => db.AuditEvents.Add(ControlRoomHistoryRow.Build(entry));

    public Task SaveChangesAsync(CancellationToken ct) => db.SaveChangesAsync(ct);
}
