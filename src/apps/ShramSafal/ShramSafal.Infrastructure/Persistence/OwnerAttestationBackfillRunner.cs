// spec: dfes-companion-2026-07-11 (wave-1.5)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.UseCases.Logs.BackfillOwnerAttestations;
using ShramSafal.Infrastructure.Persistence.Repositories;

namespace ShramSafal.Infrastructure.Persistence;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.5) — gives
/// <see cref="BackfillOwnerAttestationsHandler"/> the only database posture from which it
/// can actually see the farm history it exists to repair.
///
/// <para><b>Why the handler cannot just be resolved from DI.</b> The scoped
/// <c>IShramSafalRepository</c> is built over a <see cref="ShramSafalDbContext"/> that
/// carries <c>TenantConnectionInterceptor</c>, and the repair spans every farm in the
/// system so there is no single tenant claim to set. Calling
/// <c>TenantContext.ElevateToAdminCrossTenant()</c> is NOT sufficient and fails in the
/// worst possible way: it only tells the interceptor to skip GUC injection, after which
/// the RLS policy <c>farm_id = current_setting('agrisync.farm_id', true)::uuid</c>
/// evaluates against NULL and returns ZERO ROWS. The backfill would then report
/// "no logs need repair" against a database full of stuck days and every assertion about
/// its boundaries would pass vacuously. (This is the documented 03.4 boundary on
/// <see cref="IAdminDbContextFactory{TContext}"/>, and it was reproduced here before this
/// runner existed.)</para>
///
/// <para><b>So it goes through the admin factory</b>, exactly as
/// <c>BackfillFarmOwnerAccounts</c>, <c>RetentionSweepWorker</c> and the privacy workers
/// do: a context with no interceptor attached, on the privileged migration connection,
/// and an <c>admin_cross_tenant</c> audit row written BEFORE the context is handed over —
/// so the elevation is on the ledger even if the repair then crashes.</para>
///
/// <para><b>Why this class lives in Infrastructure.</b> <c>ShramSafalRepository</c> is
/// <c>internal</c>, so only this assembly can pair it with a hand-built context. Nothing
/// about the repair's RULES lives here: authority is still
/// <c>GetUserRoleForFarmAsync</c> and the FSM is still
/// <c>VerificationStateMachine</c>, both reached through the same handler the rest of the
/// application would use. This type supplies a connection and nothing else.</para>
/// </summary>
public sealed class OwnerAttestationBackfillRunner(
    IAdminDbContextFactory<ShramSafalDbContext> adminDbContextFactory,
    IIdGenerator idGenerator,
    IClock clock,
    ILogger<BackfillOwnerAttestationsHandler> handlerLogger)
{
    /// <summary>
    /// Runs one pass and commits it. Each pass gets its own privileged context so a long
    /// history is not repaired inside one transaction that holds locks across the whole
    /// <c>daily_logs</c> table while the API is booting. Prefer
    /// <see cref="RunUntilDrainedAsync"/>, which owns the cursor; this overload starts at
    /// the oldest candidate every time and is for callers that want exactly one page.
    /// </summary>
    public Task<BackfillOwnerAttestationsResult> RunPassAsync(
        int batchSize, CancellationToken ct)
        => RunPassAsync(batchSize, afterCreatedAtUtc: null, afterId: null, ct);

    /// <summary>
    /// Runs one pass starting after the supplied (CreatedAtUtc, Id) cursor.
    /// </summary>
    public async Task<BackfillOwnerAttestationsResult> RunPassAsync(
        int batchSize, DateTime? afterCreatedAtUtc, Guid? afterId, CancellationToken ct)
    {
        await using var adminDb = await adminDbContextFactory.CreateAsync(
            reason: nameof(OwnerAttestationBackfillRunner),
            actorUserId: SystemActor.Worker,
            ct: ct);

        var repository = new ShramSafalRepository(adminDb);
        var handler = new BackfillOwnerAttestationsHandler(
            repository, idGenerator, clock, handlerLogger);

        var result = await handler.HandleAsync(
            new BackfillOwnerAttestationsCommand(batchSize, afterCreatedAtUtc, afterId), ct);

        return result.IsSuccess
            ? result.Value!
            : throw new InvalidOperationException(
                $"Owner-attestation backfill pass failed: {result.Error?.ToString() ?? "unknown"}");
    }

    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-1.5 review, I1) — walks the WHOLE candidate
    /// set, page by page, and stops only when it runs out of candidates or hits
    /// <paramref name="maxPasses"/>.
    ///
    /// <para><b>The loop this replaces could skip repairable days permanently.</b> It broke
    /// out on a full batch that attested nothing, reasoning that "every candidate was
    /// correctly skipped, so the work that could be done, was". That reasoning holds only if
    /// the refused rows are the ONLY rows. They are not, and they are also the STICKIEST
    /// rows: a mukadam's day and a departed member's day are refused every time and keep
    /// their place at the front of an oldest-first ordering forever. One full batch of them
    /// sorting ahead of an owner's stuck day meant that day was never reached — not on that
    /// boot, and not on any later one, because every restart began the same walk from the
    /// same front. Silent, permanent, and indistinguishable in the logs from "nothing left
    /// to do".</para>
    ///
    /// <para><b>Why a cursor and not a bigger batch.</b> A bigger batch moves the wall, it
    /// does not remove it: N+1 un-attestable rows put it back. Carrying the last row
    /// examined forward makes each pass start where the last one ENDED, so refusals are
    /// stepped over exactly once per drain and progress is guaranteed regardless of how
    /// many there are.</para>
    ///
    /// <para><b>What still bounds this.</b> <paramref name="maxPasses"/>. Because refusals
    /// are now paged THROUGH rather than re-read, the ceiling bounds total candidates
    /// examined per drain, not total repairs. A history with more than
    /// <c>maxPasses * batchSize</c> permanently-un-attestable logs would still have a tail
    /// this never reaches — restarts do not help there, since a drain always begins at the
    /// oldest candidate and no cursor is persisted (deliberately: a stored marker is the
    /// thing this repair avoids, because it can drift out of step with the data). At pilot
    /// scale that ceiling is 20 000 logs and this is theoretical; it is written down rather
    /// than left to be discovered.</para>
    /// </summary>
    public async Task<BackfillOwnerAttestationsDrainResult> RunUntilDrainedAsync(
        int batchSize, int maxPasses, CancellationToken ct)
    {
        DateTime? afterCreatedAtUtc = null;
        Guid? afterId = null;

        var passes = 0;
        var scanned = 0;
        var attested = 0;
        var leftForReview = 0;
        var drained = false;

        while (passes < maxPasses && !ct.IsCancellationRequested)
        {
            passes++;

            var pass = await RunPassAsync(batchSize, afterCreatedAtUtc, afterId, ct);

            scanned += pass.Scanned;
            attested += pass.Attested;
            leftForReview += pass.LeftForReview;

            // Under the ceiling means there is nothing past this page: the candidate set
            // is exhausted. This is the ONLY early exit — note in particular that a pass
            // which attested nothing is no longer one, because a page of pure refusals
            // says nothing at all about what sorts behind it.
            if (pass.Scanned < batchSize)
            {
                drained = true;
                break;
            }

            afterCreatedAtUtc = pass.LastCreatedAtUtc;
            afterId = pass.LastId;
        }

        return new BackfillOwnerAttestationsDrainResult(
            passes, scanned, attested, leftForReview, ReachedPassCeiling: !drained);
    }
}

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.5 review, I1) — the totals across one drain.
/// </summary>
/// <param name="Passes">Pages read.</param>
/// <param name="Scanned">Candidates examined across all pages.</param>
/// <param name="Attested">Days closed on their own creator's owner authority.</param>
/// <param name="LeftForReview">Days deliberately refused; they stay in the review inbox.</param>
/// <param name="ReachedPassCeiling">
/// True when the walk stopped at the pass ceiling rather than running out of candidates —
/// i.e. some of the history was NOT looked at. Kept separate from the counts because "0
/// attested after 40 full passes" and "0 attested, nothing left" are opposite situations.
/// </param>
public sealed record BackfillOwnerAttestationsDrainResult(
    int Passes,
    int Scanned,
    int Attested,
    int LeftForReview,
    bool ReachedPassCeiling);
