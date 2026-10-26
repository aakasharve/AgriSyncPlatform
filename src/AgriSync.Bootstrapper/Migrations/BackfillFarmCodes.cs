// spec: plr-d7-m1-multiuser-2026-10-26 (step 1)
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Migrations;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — runs <see cref="FarmCodeBackfillRunner"/> once
/// at startup so every farm made before codes were assigned everywhere gets one.
///
/// <para><b>Why a hosted service and not an EF migration.</b> The code must come from the one
/// generator (<c>FarmCode.New()</c>, the OS CSPRNG) and land through the one collision-safe
/// write path (<c>EnsureFarmCodeAsync</c>); restating either in SQL would be a second generator
/// no test compares against the first. Same pattern as <see cref="BackfillFarmOwnerAccounts"/>
/// and <see cref="BackfillOwnerAttestations"/>.</para>
///
/// <para><b>Safe to re-run, by data.</b> Only farms with no code are touched, so the second
/// startup finds nothing. <b>Never fatal:</b> a failure is logged and the API keeps starting;
/// the next restart picks up where the data says it stopped.</para>
/// </summary>
internal sealed class BackfillFarmCodes(
    IServiceProvider services,
    ILogger<BackfillFarmCodes> logger)
    : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = services.CreateAsyncScope();
            var runner = scope.ServiceProvider.GetRequiredService<FarmCodeBackfillRunner>();

            var result = await runner.RunAsync(cancellationToken);

            if (result.FarmsWithoutCode == 0)
            {
                logger.LogInformation("Farm-code backfill: every farm already has a code.");
                return;
            }

            logger.LogInformation(
                "Farm-code backfill: {Assigned} of {FarmsWithoutCode} farm(s) without a code received one.",
                result.Assigned, result.FarmsWithoutCode);
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "Farm-code backfill failed. The service will continue to start; a farm still without a " +
                "code gets one when its owner opens the invite sheet, or on the next restart.");
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
