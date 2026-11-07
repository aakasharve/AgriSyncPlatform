// spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2, fix round 1 (review L-10)
using System;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;
using H = ShramSafal.Sync.IntegrationTests.Labour.PurveshDemoReseedHarness;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// spec: plr-d10 lane MU-2 fix round 1 (L-10) — a demo farm whose owner made a personal invitation is still cleared by
/// <c>CLEAR_PURVESH_DEMO=true</c>, as the role a developer's startup path runs as (<c>agrisync_app</c>, which holds no
/// DELETE on <c>ssf.farm_personal_invitations</c>): the invitations go with their farm, and nobody else's do.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class PurveshDemoClearWithInvitationsRealPostgresTests(PurveshDemoReseedTemplateWithoutNonSeedWorkerFixture fixture)
    : IClassFixture<PurveshDemoReseedTemplateWithoutNonSeedWorkerFixture>
{
    private static readonly DateTime RunUtc = new(2026, 3, 10, 6, 30, 0, DateTimeKind.Utc);

    [Fact]
    public async Task The_demo_clear_removes_the_demo_farms_invitations_with_the_farm_and_keeps_every_other_farms()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(fixture.Template);
        var reseed = await H.RunReseedAsync(s.AppProvider(), RunUtc, dryRun: false);
        reseed.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, reseed.Output);

        await PlantInvitationAsync(s.SuperuserConn, PurveshDemoSeeder.DemoFarmId, "71000001");
        await PlantInvitationAsync(s.SuperuserConn, fixture.Template.StrangerFarmId, "71000002");

        var provider = s.AppProvider(environmentName: "Development");
        await using (var scope = provider.CreateAsyncScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
            await scope.ServiceProvider.GetRequiredService<PurveshDemoSeeder>().ClearPurveshDemoAsync();
        }

        (await CountAsync(s.SuperuserConn, PurveshDemoSeeder.DemoFarmId)).Should().Be(0, "the demo farm's invitations went with it");
        (await CountAsync(s.SuperuserConn, fixture.Template.StrangerFarmId)).Should().Be(1, "another farm's invitation is not the demo's");
    }

    private static Task PlantInvitationAsync(string superuserConn, Guid farm, string code)
        => H.ExecAsync(superuserConn, """
            INSERT INTO ssf.farm_personal_invitations (id, farm_id, farm_name, invited_by_user_id, label, plot_scope, scope_plot_ids,
                scope_plot_names, authorities, code, created_at_utc, expires_at_utc, status, waits_for_owner, worker_linked)
            SELECT @id, f."Id", f.name, f.owner_user_id, 'Worker', 'OwnWork', '{}', '{}', '{}'::jsonb, @code,
                   NOW(), NOW() + INTERVAL '7 days', 'Waiting', FALSE, FALSE
            FROM ssf.farms f WHERE f."Id" = @farm
            """, ("id", Guid.NewGuid()), ("farm", farm), ("code", code));

    private static async Task<long> CountAsync(string superuserConn, Guid farm)
    {
        await using var db = new NpgsqlConnection(superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.farm_personal_invitations WHERE farm_id = @f";
        cmd.Parameters.AddWithValue("f", farm);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }
}
