using Microsoft.EntityFrameworkCore;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using User.Application.Ports;
using User.Domain.Identity;

namespace User.Infrastructure.Persistence.Repositories;

/// <summary>
/// <para>
/// <b>RLS note (the reason these two reads are not one-liners).</b>
/// <c>UserConfiguration</c> marks the <c>Memberships</c> navigation
/// <c>AutoInclude()</c>, so every <c>db.Users</c> materialisation LEFT JOINs
/// <c>public.memberships</c> — and that table has ROW LEVEL SECURITY ENABLED
/// <b>and FORCED</b> with policy <c>p_user_memberships</c>
/// (<c>user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid</c>).
/// The whole auth surface is on <see cref="AgriSync.BuildingBlocks.Persistence.TenantTransactionMiddleware"/>'s
/// <c>"/user/auth"</c> skip-list (anonymous by definition: nobody has
/// authenticated yet), which admin-elevates — and admin elevation sets NO GUC.
/// So the join matched nothing, <c>user.Memberships</c> came back empty, and
/// <c>JwtTokenIssuer</c> minted an access token with no <c>membership</c> claim.
/// Downstream, <c>EndpointActorContext.GetActorRoleEnum</c> fell back to
/// <c>AppRole.Worker</c> and <c>POST /shramsafal/compliance/evaluate/{farmId}</c>
/// answered 403 to the farm's own PrimaryOwner. Proof, as <c>agrisync_app</c>:
/// <c>SELECT count(*) FROM public.memberships</c> = 0 without the setting, 1 with it.
/// </para>
/// <para>
/// Fix: establish the caller's identity through
/// <see cref="RlsIdentityScope.RunAsUserAsync{T}"/> before the membership join
/// runs. <c>public.users</c> itself carries no policy, so the id lookup that
/// bootstraps the identity is safe to run unscoped.
/// </para>
/// </summary>
internal sealed class UserRepository(UserDbContext db) : IUserRepository
{
    public Task<Domain.Identity.User?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var userId = new UserId(id);
        // Tracked on purpose — LoginHandler mutates the returned aggregate
        // (MarkPhoneVerified) and saves it.
        return RlsIdentityScope.RunAsUserAsync(
            db,
            id,
            token => db.Users.FirstOrDefaultAsync(u => u.Id == userId, token),
            ct);
    }

    public async Task<Domain.Identity.User?> GetByPhoneAsync(string phone, CancellationToken ct = default)
    {
        // Two steps, deliberately. We cannot set `agrisync.user_id` before we
        // know who the caller is, so resolve the id first from the unprotected
        // public.users table with the membership auto-include suppressed, then
        // read the full aggregate under that identity.
        var userId = await db.Users
            .AsNoTracking()
            .IgnoreAutoIncludes()
            .Where(u => u.Phone.Value == phone)
            .Select(u => u.Id)
            .FirstOrDefaultAsync(ct);

        return userId == UserId.Empty
            ? null
            : await GetByIdAsync(userId.Value, ct);
    }

    public async Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default)
    {
        // AnyAsync never materialises the navigation, so no membership join and
        // no RLS exposure here.
        return await db.Users.AnyAsync(u => u.Phone.Value == phone, ct);
    }

    public async Task AddAsync(Domain.Identity.User user, CancellationToken ct = default)
    {
        await db.Users.AddAsync(user, ct);
    }

    public async Task SaveChangesAsync(CancellationToken ct = default)
    {
        await db.SaveChangesAsync(ct);
    }
}
