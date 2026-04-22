using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using ShramSafal.Domain.Organizations;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Infrastructure;

/// <summary>
/// Transitional bridge for the W0-A → W0-B admin auth pivot.
///
/// Before W0-B: admin = present in <c>appsettings.Admins[]</c> config; JwtTokenIssuer
/// stamped a <c>membership: shramsafal:admin</c> claim for those userIds.
///
/// After W0-B: admin = has an active Platform+Owner row in
/// <c>ssf.organization_memberships</c>. Resolver reads the DB per request.
///
/// This seeder closes the gap: for every userId listed in <c>Admins[]</c>,
/// ensure a Platform+Owner membership exists. Runs at startup after migrations
/// so dev + prod keep working through the pivot. Idempotent (checks
/// IsActive before inserting).
///
/// Remove this seeder (and the Admins[] config array) in a later hardening
/// pass once UI-driven admin management lands.
/// </summary>
public sealed class PlatformAdminBridgeSeeder
{
    /// <summary>Fixed id — must match ssf.organizations row seeded by migration.</summary>
    public static readonly Guid PlatformOrgId = Guid.Parse("00000000-0000-0000-0000-00000000a000");

    private readonly ShramSafalDbContext _ctx;
    private readonly IConfiguration _configuration;
    private readonly ILogger<PlatformAdminBridgeSeeder> _logger;

    public PlatformAdminBridgeSeeder(
        ShramSafalDbContext ctx,
        IConfiguration configuration,
        ILogger<PlatformAdminBridgeSeeder> logger)
    {
        _ctx = ctx;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<int> EnsureAsync(CancellationToken ct = default)
    {
        var adminIds = _configuration.GetSection("Admins").Get<string[]>()
            ?.Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty)
            .Where(g => g != Guid.Empty)
            .ToArray()
            ?? [];

        if (adminIds.Length == 0)
        {
            _logger.LogInformation(
                "PlatformAdminBridgeSeeder: no Admins[] configured. Skipping — assumes admins are managed via UI.");
            return 0;
        }

        var platformExists = await _ctx.Organizations
            .AnyAsync(o => o.Id == PlatformOrgId && o.IsActive, ct);
        if (!platformExists)
        {
            _logger.LogWarning(
                "PlatformAdminBridgeSeeder: Platform org row not found. Migration SeedPlatformOrgAndExistingAdmins may not have run. Skipping.");
            return 0;
        }

        var existingAdminUserIds = await _ctx.OrganizationMemberships
            .Where(m => m.OrganizationId == PlatformOrgId
                        && m.Role == OrganizationRole.Owner
                        && m.IsActive)
            .Select(m => m.UserId.Value)
            .ToListAsync(ct);

        var inserted = 0;
        foreach (var adminId in adminIds)
        {
            if (existingAdminUserIds.Contains(adminId)) continue;

            var membership = OrganizationMembership.Create(
                id: Guid.NewGuid(),
                organizationId: PlatformOrgId,
                userId: new UserId(adminId),
                role: OrganizationRole.Owner,
                addedByUserId: new UserId(adminId),
                joinedAtUtc: DateTime.UtcNow);

            _ctx.OrganizationMemberships.Add(membership);
            inserted++;
        }

        if (inserted > 0)
        {
            await _ctx.SaveChangesAsync(ct);
            _logger.LogInformation(
                "PlatformAdminBridgeSeeder: seeded {Count} Platform+Owner membership(s) from Admins[] config.",
                inserted);
        }
        else
        {
            _logger.LogInformation(
                "PlatformAdminBridgeSeeder: all {Count} configured admin(s) already have memberships.",
                adminIds.Length);
        }

        return inserted;
    }
}
