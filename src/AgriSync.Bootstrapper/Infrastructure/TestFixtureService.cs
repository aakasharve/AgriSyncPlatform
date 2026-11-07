using AgriSync.Bootstrapper.Endpoints;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Infrastructure;

public sealed class TestFixturesDisabledException(string message) : System.Exception(message);

public sealed record FixtureResult(string Fixture, string Action, string Summary);

/// <summary>
/// Runtime reset/seed of known test fixtures. Hard-blocks ALL destructive paths in
/// Production (before any DB access). Reset is bounded by the configured owner-account
/// allowlist. Spec: test-fixture-service-runtime-2026-06-06.
/// </summary>
public sealed class TestFixtureService(
    IHostEnvironment env,
    IOptions<TestFixtureOptions> options,
    IServiceProvider services,
    ILogger<TestFixtureService> logger)
{
    private static readonly string[] KnownFixtures =
        ["blank-test-user", "purvesh-demo", "admin-two-orgs"];

    private readonly TestFixtureOptions _opts = options.Value;

    public IReadOnlyList<string> ListFixtures() => KnownFixtures;

    private void GuardDestructive(string action)
    {
        if (action is not ("reset" or "seed"))
            throw new System.ArgumentOutOfRangeException(nameof(action), action, "Unknown destructive action.");
        if (env.IsProduction())
        {
            throw new TestFixturesDisabledException(
                $"Test fixture {action} is permanently disabled in Production. No override exists by design.");
        }
        var allowed = action == "reset" ? _opts.AllowRuntimeReset : _opts.AllowRuntimeSeed;
        if (!allowed)
        {
            throw new TestFixturesDisabledException(
                $"Test fixture {action} is not enabled (TestFixtures:AllowRuntime{(action == "reset" ? "Reset" : "Seed")}=false).");
        }
    }

    public Task<FixtureResult> ResetFixtureAsync(string fixture, CancellationToken ct = default)
    {
        GuardDestructive("reset");
        return ResetInternalAsync(Normalize(fixture), ct);
    }

    public Task<FixtureResult> SeedFixtureAsync(string fixture, CancellationToken ct = default)
    {
        GuardDestructive("seed");
        return SeedInternalAsync(Normalize(fixture), ct);
    }

    // Intentional double-guard: reset+seed requires BOTH AllowRuntimeReset AND AllowRuntimeSeed.
    public async Task<FixtureResult> ResetAndSeedFixtureAsync(string fixture, CancellationToken ct = default)
    {
        await ResetFixtureAsync(fixture, ct);
        return await SeedFixtureAsync(fixture, ct);
    }

    private static string Normalize(string f) => (f ?? "").Trim().ToLowerInvariant();

    private async Task<FixtureResult> ResetInternalAsync(string fixture, CancellationToken ct)
    {
        if (_opts.AllowedOwnerAccountIds.Count == 0)
        {
            logger.LogWarning("TestFixtures reset: allowlist empty; deleting nothing (fixture={Fixture})", fixture);
            return new FixtureResult(fixture, "reset", "allowlist empty — 0 rows deleted");
        }

        using var scope = services.CreateScope();
        // Cross-tenant elevation is required to read/delete across tenants; the allowlist
        // above — NOT elevation — is the safety boundary. (Mirrors the old E2e pattern.)
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        var ssf = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

        switch (fixture)
        {
            case "purvesh-demo":
                {
                    // Delegate to the already-scoped clear (deletes only Purvesh deterministic ids).
                    var purvesh = scope.ServiceProvider.GetRequiredService<PurveshDemoSeeder>();
                    var summary = await purvesh.ClearPurveshDemoAsync(ct);
                    logger.LogInformation(
                        "TestFixtures {Action} complete: actor={Actor} fixture={Fixture} env={Env} result={Summary}",
                        "reset", "test-fixture-service", fixture, env.EnvironmentName, summary);
                    return new FixtureResult(fixture, "reset", summary);
                }
            default:
                {
                    var summary = await DeleteByAllowlistAsync(
                        ssf,
                        scope.ServiceProvider.GetService<IAdminDbContextFactory<ShramSafalDbContext>>(),
                        ct);
                    logger.LogInformation(
                        "TestFixtures {Action} complete: actor={Actor} fixture={Fixture} env={Env} result={Summary}",
                        "reset", "test-fixture-service", fixture, env.EnvironmentName, summary);
                    return new FixtureResult(fixture, "reset", summary);
                }
        }
    }

    // Generic safety-net delete: bounded strictly to farms whose OwnerAccountId is allowlisted.
    // Repo-truth: LogTask/VerificationEvent (DailyLogId) + FinanceCorrection (CostEntryId) have NO
    // FarmId — reached via Guid parent-id sets. The other six carry a value-object FarmId; compare
    // with single-value `== farmId` (proven-translatable), NEVER List<FarmId>.Contains.
    private async Task<string> DeleteByAllowlistAsync(
        ShramSafalDbContext ssf,
        IAdminDbContextFactory<ShramSafalDbContext>? adminFactory,
        CancellationToken ct)
    {
        var farmCount = 0;
        var total = 0;
        var byTable = new System.Collections.Generic.Dictionary<string, int>
        {
            ["dailyLogContents"] = 0,
            ["logTasks"] = 0,
            ["verificationEvents"] = 0,
            ["dailyLogs"] = 0,
            ["financeCorrections"] = 0,
            ["costEntryApprovals"] = 0,
            ["dayLedgers"] = 0,
            ["costEntries"] = 0,
            ["attachments"] = 0,
            ["cropCycles"] = 0,
            ["plots"] = 0,
        };

        foreach (var ownerGuid in _opts.AllowedOwnerAccountIds)
        {
            var ownerId = new AgriSync.SharedKernel.Contracts.Ids.OwnerAccountId(ownerGuid);
            var farmIds = await ssf.Farms
                .Where(f => f.OwnerAccountId == ownerId)
                .Select(f => f.Id)
                .ToListAsync(ct);

            foreach (var farmId in farmIds)
            {
                farmCount++;

                var logIds = await ssf.DailyLogs
                    .Where(l => l.FarmId == farmId).Select(l => l.Id).ToListAsync(ct);
                var costIds = await ssf.CostEntries
                    .Where(c => c.FarmId == farmId).Select(c => c.Id).ToListAsync(ct);

                // spec: plr-d10 (lane F1, review N8) — a log's stored details go BEFORE the log
                // (their foreign key is RESTRICT: deleting the log first fails with 23503), and
                // through the admin path, because the app role may only append to that table.
                var n = await DeleteStoredDetailsAsync(adminFactory, (Guid)farmId, ownerGuid, logIds, ct);
                byTable["dailyLogContents"] += n; total += n;

                n = await ssf.LogTasks
                    .Where(t => logIds.Contains(t.DailyLogId)).ExecuteDeleteAsync(ct);
                byTable["logTasks"] += n; total += n;

                n = await ssf.VerificationEvents
                    .Where(v => logIds.Contains(v.DailyLogId)).ExecuteDeleteAsync(ct);
                byTable["verificationEvents"] += n; total += n;

                n = await ssf.DailyLogs
                    .Where(l => l.FarmId == farmId).ExecuteDeleteAsync(ct);
                byTable["dailyLogs"] += n; total += n;

                // spec: plr-d10 lane BILL-1 fix round 1 (review M1) — a bill's मंजूर stamps go BEFORE the bill (RESTRICT), through
                // the admin path: the app role may only append to that table.
                n = await DeleteBillApprovalsAsync(adminFactory, (Guid)farmId, ownerGuid, costIds, ct);
                byTable["costEntryApprovals"] += n; total += n;

                n = await ssf.FinanceCorrections
                    .Where(fc => costIds.Contains(fc.CostEntryId)).ExecuteDeleteAsync(ct);
                byTable["financeCorrections"] += n; total += n;

                n = await ssf.DayLedgers
                    .Where(dl => dl.FarmId == farmId).ExecuteDeleteAsync(ct);
                byTable["dayLedgers"] += n; total += n;

                n = await ssf.CostEntries
                    .Where(c => c.FarmId == farmId).ExecuteDeleteAsync(ct);
                byTable["costEntries"] += n; total += n;

                n = await ssf.Attachments
                    .Where(a => a.FarmId == farmId).ExecuteDeleteAsync(ct);
                byTable["attachments"] += n; total += n;

                n = await ssf.CropCycles
                    .Where(c => c.FarmId == farmId).ExecuteDeleteAsync(ct);
                byTable["cropCycles"] += n; total += n;

                n = await ssf.Plots
                    .Where(p => p.FarmId == farmId).ExecuteDeleteAsync(ct);
                byTable["plots"] += n; total += n;
                // Farm shell + FarmMemberships kept so a re-seed is idempotent.
            }
        }

        var perTable = string.Join(", ", byTable.Select(kv => $"{kv.Key}={kv.Value}"));
        return farmCount == 0
            ? "no allowlisted test farms found — 0 rows deleted"
            : $"deleted {total} rows across {farmCount} farm(s) [{perTable}]";
    }

    /// <summary>
    /// spec: plr-d10 (lane F1, review N8) — deletes the stored details (<c>ssf.daily_log_contents</c>)
    /// of these logs of one allowlisted farm, through the admin context (the migration connection):
    /// the app role holds no DELETE on that append-only table. The farm is set as the tenant for the
    /// one transaction, so the table's tenant policy admits exactly this farm's rows even for an
    /// owner that does not bypass row-level security.
    /// </summary>
    private static async Task<int> DeleteStoredDetailsAsync(
        IAdminDbContextFactory<ShramSafalDbContext>? adminFactory,
        Guid farmId,
        Guid ownerAccountId,
        System.Collections.Generic.List<Guid> logIds,
        CancellationToken ct)
    {
        if (logIds.Count == 0)
        {
            return 0;
        }

        if (adminFactory is null)
        {
            throw new System.InvalidOperationException(
                "Test fixture reset needs the admin database context to remove stored log details before their logs.");
        }

        await using var admin = await adminFactory.CreateAsync(
            $"{nameof(TestFixtureService)}.reset.{farmId:N}",
            AgriSync.BuildingBlocks.Auditing.SystemActor.Worker,
            ct);
        // The sanctioned tenant scope (RlsIdentityScope), never a hand-written set_config.
        return await RlsIdentityScope.RunAsFarmAsync(
            admin,
            farmId,
            ownerAccountId,
            actorUserId: null,
            token => admin.DailyLogContents
                .Where(c => logIds.Contains(c.DailyLogId))
                .ExecuteDeleteAsync(token),
            ct);
    }

    /// <summary>
    /// spec: plr-d10 lane BILL-1 fix round 1 (review M1) — deletes the मंजूर stamps (<c>ssf.cost_entry_approvals</c>) of these
    /// bills of one allowlisted farm, through the admin context, the same way as a log's stored details above.
    /// </summary>
    private static async Task<int> DeleteBillApprovalsAsync(
        IAdminDbContextFactory<ShramSafalDbContext>? adminFactory,
        Guid farmId,
        Guid ownerAccountId,
        System.Collections.Generic.List<Guid> costIds,
        CancellationToken ct)
    {
        if (costIds.Count == 0)
        {
            return 0;
        }

        if (adminFactory is null)
        {
            throw new System.InvalidOperationException(
                "Test fixture reset needs the admin database context to remove bill approval stamps before their bills.");
        }

        await using var admin = await adminFactory.CreateAsync(
            $"{nameof(TestFixtureService)}.reset-approvals.{farmId:N}",
            AgriSync.BuildingBlocks.Auditing.SystemActor.Worker,
            ct);
        var typedFarm = new AgriSync.SharedKernel.Contracts.Ids.FarmId(farmId);
        return await RlsIdentityScope.RunAsFarmAsync(
            admin,
            farmId,
            ownerAccountId,
            actorUserId: null,
            token => admin.CostEntryApprovals
                .Where(a => a.FarmId == typedFarm && costIds.Contains(a.CostEntryId))
                .ExecuteDeleteAsync(token),
            ct);
    }

    private async Task<FixtureResult> SeedInternalAsync(string fixture, CancellationToken ct)
    {
        using var scope = services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        string summary = fixture switch
        {
            "purvesh-demo" => await scope.ServiceProvider
                .GetRequiredService<PurveshDemoSeeder>().SeedPurveshDemoAsync(ct),
            "blank-test-user" => await SeedBlankAsync(scope, ct),
            "admin-two-orgs" => (await scope.ServiceProvider
                .GetRequiredService<E2eFixtureSeeder>().SeedAdminTwoOrgsAsync(ct)).ToString() ?? "admin-two-orgs seeded",
            _ => throw new System.ArgumentException($"Unknown fixture '{fixture}'.", nameof(fixture)),
        };
        logger.LogInformation(
            "TestFixtures {Action} complete: actor={Actor} fixture={Fixture} env={Env} result={Summary}",
            "seed", "test-fixture-service", fixture, env.EnvironmentName, summary);
        return new FixtureResult(fixture, "seed", summary);
    }

    private static async Task<string> SeedBlankAsync(IServiceScope scope, CancellationToken ct)
    {
        await scope.ServiceProvider.GetRequiredService<BlankTestUserSeeder>().SeedAsync(ct);
        return "blank test user seeded";
    }
}
