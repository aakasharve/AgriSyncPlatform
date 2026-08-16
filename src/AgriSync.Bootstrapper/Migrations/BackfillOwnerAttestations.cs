// spec: dfes-companion-2026-07-11 (wave-1.5)
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Migrations;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.5) — runs the owner-attestation repair once at
/// startup, then gets out of the way.
///
/// <para><b>What it repairs.</b> Every day a pilot farmer recorded before wave-1.3 shipped
/// is sitting with no verification history at all, which the server reports as
/// <c>Draft</c> on every pull. His own stuck days are invisible in the review inbox — that
/// screen lists logs created by SOMEONE ELSE — so there is no screen in the product that
/// can clear them. This closes them, once, on the same authority the live path would have
/// used at the time.</para>
///
/// <para><b>Why a hosted service and not an EF migration.</b> The decision of who may be
/// attested for is made by <c>GetUserRoleForFarmAsync</c> and
/// <c>VerificationStateMachine</c>. Expressing it as SQL inside a migration would restate
/// the owner-role set and the transition table in a second place that no test compares
/// against the first. This runs the real handler, so the rules cannot diverge. It follows
/// <see cref="BackfillFarmOwnerAccounts"/>, the pattern already established here for a data
/// repair that has to think.</para>
///
/// <para><b>Safe to re-run, by data rather than by flag.</b> Only logs with NO verification
/// events are candidates, and the repair gives each one two — so a second startup finds
/// nothing and does nothing. There is no marker row to drift out of sync with reality, and
/// no flag that could be left set after a rollback.</para>
///
/// <para><b>Never fatal.</b> A failure is logged and swallowed: this is a repair of history,
/// and it must not stop the API from serving today's farmers. Re-running it is just another
/// restart.</para>
/// </summary>
internal sealed class BackfillOwnerAttestations(
    IServiceProvider services,
    ILogger<BackfillOwnerAttestations> logger)
    : IHostedService
{
    /// <summary>
    /// Ceiling per pass. The repair loops until a pass comes back under the ceiling, so a
    /// large history is drained across several passes instead of one enormous transaction
    /// that holds locks over the whole <c>daily_logs</c> table while the API is booting.
    /// </summary>
    private const int BatchSize = 500;

    /// <summary>
    /// Bounds the loop so a pathological case (a pass that somehow attests nothing yet keeps
    /// returning a full batch) cannot spin at startup forever. At 500 per pass this covers
    /// 20 000 logs, far beyond pilot scale; if it is ever hit, the WARNING says so and the
    /// next restart resumes exactly where this one stopped.
    /// </summary>
    private const int MaxPasses = 40;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            var totalScanned = 0;
            var totalAttested = 0;
            var totalLeftForReview = 0;
            var pass = 0;

            while (pass < MaxPasses && !cancellationToken.IsCancellationRequested)
            {
                pass++;

                // A NEW scope per pass; the runner opens (and audits) its own privileged
                // cross-tenant context inside each one and disposes it before returning.
                await using var scope = services.CreateAsyncScope();

                var runner = scope.ServiceProvider
                    .GetRequiredService<OwnerAttestationBackfillRunner>();

                var value = await runner.RunPassAsync(BatchSize, cancellationToken);

                totalScanned += value.Scanned;
                totalAttested += value.Attested;
                totalLeftForReview += value.LeftForReview;

                // Under the ceiling means the candidate set is exhausted.
                if (value.Scanned < BatchSize)
                {
                    break;
                }

                // A full batch that attested NOTHING means every candidate was correctly
                // skipped (mukadam-recorded days, departed members). Those stay candidates
                // forever — they have no verification events and never will until a human
                // approves them — so continuing would re-read the same 500 rows until
                // MaxPasses. Stop: the work that could be done, was.
                if (value.Attested == 0)
                {
                    break;
                }
            }

            if (pass >= MaxPasses)
            {
                logger.LogWarning(
                    "Owner-attestation backfill stopped at the {MaxPasses}-pass ceiling. " +
                    "It is idempotent — the next restart resumes from where this stopped.",
                    MaxPasses);
            }

            if (totalScanned == 0)
            {
                logger.LogInformation(
                    "Owner-attestation backfill: no unassessed logs found; history is already clean.");
                return;
            }

            logger.LogInformation(
                "Owner-attestation backfill finished in {Passes} pass(es): scanned {Scanned}, " +
                "closed {Attested} day(s) the farmer had recorded himself, left {LeftForReview} " +
                "waiting for an owner to approve.",
                pass, totalScanned, totalAttested, totalLeftForReview);
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "Owner-attestation backfill failed. The service will continue to start; " +
                "the repair is idempotent and re-runs safely on the next restart.");
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
