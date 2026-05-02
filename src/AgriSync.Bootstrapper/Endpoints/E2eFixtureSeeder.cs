using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Organizations;
using ShramSafal.Infrastructure.Persistence;
using User.Application.Ports;
using User.Domain.Identity;
using User.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Endpoints;

/// <summary>
/// Sub-plan 05 Task 2b (T-IGH-05-ADMIN-TWO-ORGS-SEEDER).
/// Seeds the <c>admin_two_orgs</c> fixture: one admin user, two FPO
/// organisations, two farms (one per org), two memberships, and two
/// farm-scope grants.
///
/// All row IDs are deterministic so the seed is fully idempotent — a
/// second call produces zero new rows and returns the same response.
/// </summary>
public sealed class E2eFixtureSeeder(
    ShramSafalDbContext ssfContext,
    UserDbContext userContext,
    IPasswordHasher passwordHasher)
{
    // -----------------------------------------------------------------------
    // Fixture constants
    // -----------------------------------------------------------------------
    private const string FixtureName      = "admin_two_orgs";
    private const string AdminPhone       = "8888888888";
    private const string AdminPassword    = "admin123";
    private const string AdminDisplayName = "E2E Admin";
    private const string AppId            = "shramsafal";

    // Deterministic IDs — guaranteed never to collide with the ramu fixture
    // (which uses SHA-256-derived GUIDs keyed on "phase0-seed-v1:...").
    public static readonly Guid AdminUserIdValue      = Guid.Parse("00000000-0000-0000-0000-000000000098");
    public static readonly Guid OrgAId               = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    public static readonly Guid OrgBId               = Guid.Parse("00000000-0000-0000-0000-0000000000a2");
    public static readonly Guid MembershipAId        = Guid.Parse("00000000-0000-0000-0000-0000000000b1");
    public static readonly Guid MembershipBId        = Guid.Parse("00000000-0000-0000-0000-0000000000b2");
    public static readonly Guid FarmAId              = Guid.Parse("00000000-0000-0000-0000-0000000000f1");
    public static readonly Guid FarmBId              = Guid.Parse("00000000-0000-0000-0000-0000000000f2");
    public static readonly Guid FarmScopeAId         = Guid.Parse("00000000-0000-0000-0000-0000000000c1");
    public static readonly Guid FarmScopeBId         = Guid.Parse("00000000-0000-0000-0000-0000000000c2");

    // -----------------------------------------------------------------------
    // Main entry point
    // -----------------------------------------------------------------------

    /// <summary>
    /// Seeds all rows idempotently and returns a response object that
    /// matches the shape returned by the <c>ramu</c> fixture.
    /// </summary>
    public async Task<object> SeedAdminTwoOrgsAsync(CancellationToken ct = default)
    {
        var nowUtc = DateTime.UtcNow;
        var adminUserId = new UserId(AdminUserIdValue);

        // 1. Admin user (UserDbContext)
        var userAdded = await EnsureAdminUserAsync(adminUserId, nowUtc, ct);

        // 2. Organisations A + B (ShramSafalDbContext)
        var orgAAdded = await EnsureOrganizationAsync(OrgAId, "E2E Org Alpha (FPO)", OrganizationType.FPO, nowUtc, ct);
        var orgBAdded = await EnsureOrganizationAsync(OrgBId, "E2E Org Beta (FPO)",  OrganizationType.FPO, nowUtc, ct);

        // 3. Memberships
        var memAAdded = await EnsureMembershipAsync(MembershipAId, OrgAId, adminUserId, OrganizationRole.Owner, nowUtc, ct);
        var memBAdded = await EnsureMembershipAsync(MembershipBId, OrgBId, adminUserId, OrganizationRole.Owner, nowUtc, ct);

        // 4. Farms
        var farmAAdded = await EnsureFarmAsync(FarmAId, "E2E Farm Alpha", adminUserId, nowUtc, ct);
        var farmBAdded = await EnsureFarmAsync(FarmBId, "E2E Farm Beta",  adminUserId, nowUtc, ct);

        // 5. Farm scopes (Explicit — no PlatformWildcard needed for tests)
        var scopeAAdded = await EnsureFarmScopeAsync(FarmScopeAId, OrgAId, new FarmId(FarmAId), adminUserId, nowUtc, ct);
        var scopeBAdded = await EnsureFarmScopeAsync(FarmScopeBId, OrgBId, new FarmId(FarmBId), adminUserId, nowUtc, ct);

        await ssfContext.SaveChangesAsync(ct);
        await userContext.SaveChangesAsync(ct);

        var newRows = (userAdded ? 1 : 0) + (orgAAdded ? 1 : 0) + (orgBAdded ? 1 : 0)
                    + (memAAdded ? 1 : 0) + (memBAdded ? 1 : 0)
                    + (farmAAdded ? 1 : 0) + (farmBAdded ? 1 : 0)
                    + (scopeAAdded ? 1 : 0) + (scopeBAdded ? 1 : 0);

        var summary = newRows == 0
            ? "admin_two_orgs fixture already seeded."
            : $"admin_two_orgs fixture seeded successfully. New rows: {newRows}.";

        return new
        {
            userId   = AdminUserIdValue.ToString(),
            phone    = AdminPhone,
            password = AdminPassword,
            farmId   = FarmAId.ToString(),
            fixture  = FixtureName,
            summary,
        };
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private async Task<bool> EnsureAdminUserAsync(
        UserId adminUserId,
        DateTime nowUtc,
        CancellationToken ct)
    {
        var existing = await userContext.Users
            .FirstOrDefaultAsync(u => u.Id == adminUserId, ct);

        if (existing is not null)
        {
            return false; // already seeded
        }

        var user = User.Domain.Identity.User.Register(
            adminUserId,
            User.Domain.Identity.PhoneNumber.Create(AdminPhone),
            AdminDisplayName,
            passwordHasher.Hash(AdminPassword),
            nowUtc);

        user.AddMembership(
            Guid.Parse("00000000-0000-0000-0000-0000000000e1"),
            AppId,
            User.Domain.Membership.AppRole.Worker,
            nowUtc);

        userContext.Users.Add(user);
        return true;
    }

    private async Task<bool> EnsureOrganizationAsync(
        Guid orgId,
        string name,
        OrganizationType type,
        DateTime nowUtc,
        CancellationToken ct)
    {
        var exists = await ssfContext.Organizations
            .AnyAsync(o => o.Id == orgId, ct);

        if (exists)
        {
            return false;
        }

        var org = Organization.Create(orgId, name, type, nowUtc);
        ssfContext.Organizations.Add(org);
        return true;
    }

    private async Task<bool> EnsureMembershipAsync(
        Guid membershipId,
        Guid orgId,
        UserId userId,
        OrganizationRole role,
        DateTime nowUtc,
        CancellationToken ct)
    {
        var exists = await ssfContext.OrganizationMemberships
            .AnyAsync(m => m.Id == membershipId, ct);

        if (exists)
        {
            return false;
        }

        var membership = OrganizationMembership.Create(
            membershipId,
            orgId,
            userId,
            role,
            addedByUserId: userId,
            joinedAtUtc: nowUtc);

        ssfContext.OrganizationMemberships.Add(membership);
        return true;
    }

    private async Task<bool> EnsureFarmAsync(
        Guid farmId,
        string name,
        UserId ownerUserId,
        DateTime nowUtc,
        CancellationToken ct)
    {
        var farmKey = new FarmId(farmId);
        var exists = await ssfContext.Farms
            .AnyAsync(f => f.Id == farmKey, ct);

        if (exists)
        {
            return false;
        }

        var farm = Farm.Create(farmKey, name, ownerUserId, nowUtc);
        ssfContext.Farms.Add(farm);
        return true;
    }

    private async Task<bool> EnsureFarmScopeAsync(
        Guid scopeId,
        Guid orgId,
        FarmId farmId,
        UserId grantedBy,
        DateTime nowUtc,
        CancellationToken ct)
    {
        var exists = await ssfContext.OrganizationFarmScopes
            .AnyAsync(s => s.Id == scopeId, ct);

        if (exists)
        {
            return false;
        }

        var scope = OrganizationFarmScope.Grant(
            scopeId,
            orgId,
            farmId,
            FarmScopeSource.Explicit,
            grantedBy,
            nowUtc);

        ssfContext.OrganizationFarmScopes.Add(scope);
        return true;
    }
}
