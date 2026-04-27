using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Admin.IntegrationTests;

/// <summary>
/// T-PROD-DB-OOB-TRACK regression guard.
///
/// `ssf.verifications` was created interactively on prod RDS during the
/// 2026-04-23 deploy as a compat view over `ssf.verification_events` (the
/// real table). The Phase4 / Phase7 / MIS_MatViewHealthFix migrations all
/// referenced the wrong name, and the OOB view papered over it.
///
/// Migration `MIS_DropVerificationsCompatView` (2026-04-28) folds the
/// fix into the chain: matviews are switched to query `ssf.verification_events`
/// directly, and the compat view is dropped.
///
/// This test is the regression guard: if any future migration recreates a
/// view named `ssf.verifications` (compat hack, dev convenience, anything),
/// this test fails. The contract is named in
/// `_COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md`.
/// </summary>
[Collection(nameof(AdminTestCollection))]
public sealed class SsfVerificationsRegressionTests
{
    private readonly AdminTestFixture _f;

    public SsfVerificationsRegressionTests(AdminTestFixture f) => _f = f;

    [Fact]
    public async Task SsfVerificationsViewMustNotExist()
    {
        await using var scope = _f.Services.CreateAsyncScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var conn = ctx.Database.GetDbConnection();
        await conn.OpenAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.views
                    WHERE table_schema = 'ssf'
                      AND table_name   = 'verifications'
                )";
            var exists = (bool)(await cmd.ExecuteScalarAsync())!;
            exists.Should().BeFalse(
                "ssf.verifications was an OOB compat hack created 2026-04-23 to mask " +
                "Phase4/Phase7 migration bugs. No migration may recreate it. The real " +
                "table is ssf.verification_events; matviews must join it directly. " +
                "See _COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md.");
        }
        finally
        {
            await conn.CloseAsync();
        }
    }

    [Fact]
    public async Task SsfVerificationEventsTableMustExist()
    {
        await using var scope = _f.Services.CreateAsyncScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var conn = ctx.Database.GetDbConnection();
        await conn.OpenAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'ssf'
                      AND table_name   = 'verification_events'
                      AND table_type   = 'BASE TABLE'
                )";
            var exists = (bool)(await cmd.ExecuteScalarAsync())!;
            exists.Should().BeTrue(
                "ssf.verification_events is the canonical verification record table. " +
                "If this assertion fires, the ShramSafal migration chain has been " +
                "renamed/restructured and downstream MIS matviews need updating.");
        }
        finally
        {
            await conn.CloseAsync();
        }
    }
}
