using System.IO;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Admin.IntegrationTests.Fixtures;

/// <summary>
/// Applies the shared 5-org integration-test fixture (`src/tests/Fixtures/OrgSeed.sql`)
/// to a freshly-migrated test database. IDs are deterministic so tests can
/// reference them symbolically via <see cref="OrgIds"/> and <see cref="UserIds"/>.
/// </summary>
public static class OrgSeedLoader
{
    public static async Task ApplyAsync(ShramSafalDbContext ctx, CancellationToken ct)
    {
        var path = ResolveSeedPath();
        var sql = await File.ReadAllTextAsync(path, ct);
        await ctx.Database.ExecuteSqlRawAsync(sql, ct);
    }

    /// <summary>Locates OrgSeed.sql by walking up from AppContext.BaseDirectory.</summary>
    private static string ResolveSeedPath()
    {
        const string relative = "src/tests/Fixtures/OrgSeed.sql";
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, relative);
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        throw new FileNotFoundException(
            "OrgSeed.sql not found walking up from " + AppContext.BaseDirectory);
    }

    public static class OrgIds
    {
        public static readonly Guid Fpo = Guid.Parse("10000000-0000-0000-0000-000000000001");
        public static readonly Guid Fpc = Guid.Parse("10000000-0000-0000-0000-000000000002");
        public static readonly Guid ConsultingFirm = Guid.Parse("10000000-0000-0000-0000-000000000003");
        public static readonly Guid Lab = Guid.Parse("10000000-0000-0000-0000-000000000004");
    }

    public static class UserIds
    {
        public static readonly Guid FpoOwner = Guid.Parse("20000000-0000-0000-0000-00000000f001");
        public static readonly Guid FpoEmployee = Guid.Parse("20000000-0000-0000-0000-00000000f002");
        public static readonly Guid FpcOwner = Guid.Parse("20000000-0000-0000-0000-00000000c001");
        public static readonly Guid FpcEmployee = Guid.Parse("20000000-0000-0000-0000-00000000c002");
        public static readonly Guid ConsultingOwner = Guid.Parse("20000000-0000-0000-0000-00000000cf01");
        public static readonly Guid LabOwner = Guid.Parse("20000000-0000-0000-0000-0000000001ab");
        public static readonly Guid LabOperator = Guid.Parse("20000000-0000-0000-0000-0000000002ab");
        public static readonly Guid MultiMembership = Guid.Parse("20000000-0000-0000-0000-00000000abcd");
    }
}
