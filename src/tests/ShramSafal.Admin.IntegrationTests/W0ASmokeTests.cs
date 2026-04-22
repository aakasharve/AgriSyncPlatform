using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Admin.IntegrationTests.Fixtures;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Domain.Organizations;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Admin.IntegrationTests;

/// <summary>
/// End-to-end smoke coverage for the W0-A foundation. Proves the seeded
/// 5-org fixture + resolver + redactor + projection table all line up:
///   seed  → resolve  → scope.CanRead()  → redact  → JOIN mis.effective_org_farm_scope.
/// If any piece of the spine rots, at least one of these tests fails.
/// </summary>
[Collection(nameof(AdminTestCollection))]
public sealed class W0ASmokeTests
{
    private readonly AdminTestFixture _f;

    public W0ASmokeTests(AdminTestFixture f) => _f = f;

    [Fact]
    public async Task EndToEnd_Fpo_Owner_Resolves_Reads_Redacts_AndHasEffectiveScopeRows()
    {
        await ApplyOrgSeedAsync();

        await using var scope = _f.Services.CreateAsyncScope();
        var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();
        var redactor = scope.ServiceProvider.GetRequiredService<IResponseRedactor>();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

        var fpoOwner = new UserId(OrgSeedLoader.UserIds.FpoOwner);
        var result = await resolver.ResolveAsync(fpoOwner, null, CancellationToken.None);

        result.Outcome.Should().Be(ResolveOutcome.Resolved);
        result.Scope!.OrganizationId.Should().Be(OrgSeedLoader.OrgIds.Fpo);
        result.Scope.OrganizationType.Should().Be(OrganizationType.FPO);
        result.Scope.OrganizationRole.Should().Be(OrganizationRole.Owner);
        result.Scope.IsPlatformAdmin.Should().BeFalse();
        result.Scope.CanRead(ModuleKey.CeiW1Attention).Should().BeTrue();
        result.Scope.CanRead(ModuleKey.OpsLive).Should().BeFalse(
            "Ops.Live is Platform-only — FPO Owner must not see it");

        var dto = new SampleFarmDto(Guid.NewGuid(), "Sunnyfield", "9876543210", 1500m);
        var redacted = redactor.Redact(dto, result.Scope, ModuleKey.FarmsDetail);
        redacted.FarmName.Should().Be("Sunnyfield");
        // RedactionMatrix today uses a conservative "mask by default" fallback for
        // non-Platform orgs — ownerPhone is Masked. The plan's Appendix B table is
        // aspirational (says FPO+Owner = Full). Aligning the matrix with the table
        // is deferred to W1 when real admin DTOs exist to validate against.
        redacted.OwnerPhone.Should().Contain("*",
            "FPO Owner currently sees ownerPhone Masked via conservative fallback (known gap vs plan Appendix B)");
        redacted.PayoutAmount.Should().Be(1500m,
            "FPO Owner is not Employee — payoutAmount stays Full (no Aggregated override in fallback)");

        var effectiveScopeCount = await CountEffectiveScopeRowsAsync(ctx, OrgSeedLoader.OrgIds.Fpo);
        effectiveScopeCount.Should().Be(2, "fixture grants 2 explicit farm scopes to FPO");
    }

    [Fact]
    public async Task EndToEnd_MultiMembership_WithoutActiveOrg_ReturnsAmbiguousWithBothOrgs()
    {
        await ApplyOrgSeedAsync();

        await using var scope = _f.Services.CreateAsyncScope();
        var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();

        var multi = new UserId(OrgSeedLoader.UserIds.MultiMembership);
        var result = await resolver.ResolveAsync(multi, null, CancellationToken.None);

        result.Outcome.Should().Be(ResolveOutcome.Ambiguous);
        result.Memberships.Should().HaveCount(2);
        result.Memberships.Select(m => m.OrganizationType)
            .Should().BeEquivalentTo(new[] { OrganizationType.FPO, OrganizationType.Lab });
    }

    private async Task ApplyOrgSeedAsync()
    {
        await using var scope = _f.Services.CreateAsyncScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        await OrgSeedLoader.ApplyAsync(ctx, CancellationToken.None);
    }

    private static async Task<int> CountEffectiveScopeRowsAsync(ShramSafalDbContext ctx, Guid orgId)
    {
        var conn = ctx.Database.GetDbConnection();
        await conn.OpenAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM mis.effective_org_farm_scope WHERE org_id = @o";
            var p = cmd.CreateParameter(); p.ParameterName = "o"; p.Value = orgId; cmd.Parameters.Add(p);
            return Convert.ToInt32(await cmd.ExecuteScalarAsync());
        }
        finally
        {
            await conn.CloseAsync();
        }
    }

    private sealed record SampleFarmDto(Guid FarmId, string FarmName, string OwnerPhone, decimal PayoutAmount);
}
