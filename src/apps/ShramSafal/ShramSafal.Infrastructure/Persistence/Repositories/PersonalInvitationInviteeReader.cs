using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Memberships.PersonalInvitations;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Identity;
using ShramSafal.Infrastructure.Auth;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: plr-d10 lane MU-2 (MU design §6, "one read model") — the waiting invitations that named a person's PROVEN number,
/// for <c>/me/context</c>, which runs outside the ShramSafal request pipeline. The same door
/// (<see cref="PersonalInvitationTenantScope.SetInviteeDoorAsync"/>) inside <see cref="RlsIdentityScope.RunAsUserAsync"/>,
/// and the same projection (<see cref="PersonalInvitationProjection.Card"/>) the invitee routes answer with.
/// </summary>
public sealed class PersonalInvitationInviteeReader(
    ShramSafalDbContext db,
    IUserDirectory users,
    IClock clock) : IPersonalInvitationInviteeReader
{
    public async Task<IReadOnlyList<InvitationCardView>> ListWaitingForUserAsync(Guid userId, CancellationToken ct = default)
    {
        var phone = IndianMobile.Normalize(await users.GetVerifiedPhoneAsync(userId, ct));
        if (phone is null || !db.Database.IsRelational())
        {
            return [];
        }

        var since = clock.UtcNow;
        var rows = await RlsIdentityScope.RunAsUserAsync(
            db,
            userId,
            async token =>
            {
                await PersonalInvitationTenantScope.SetInviteeDoorAsync(db, phone, null, token);
                // Fix round 1 (L-12): waiting AND unexpired, before the 50 are taken.
                var visible = await db.PersonalInvitations.AsNoTracking()
                    .Where(x => x.InvitedPhoneE164 == phone && x.Status == PersonalInvitationStatus.Waiting && x.ExpiresAtUtc > since)
                    .OrderByDescending(x => x.CreatedAtUtc)
                    .Take(50)
                    .ToListAsync(token);
                await PersonalInvitationTenantScope.SetInviteeDoorAsync(db, null, null, token);
                return visible;
            },
            ct);

        var now = clock.UtcNow;
        var waiting = rows.Where(i => i.Names(phone) && i.StatusAt(now) == PersonalInvitationStatus.Waiting).ToList();
        var names = await users.GetDisplayNamesAsync(waiting.Select(i => i.InvitedByUserId.Value), ct);
        return waiting
            .Select(i => PersonalInvitationProjection.Card(i, now, phone, names.GetValueOrDefault(i.InvitedByUserId.Value)))
            .ToList();
    }
}
