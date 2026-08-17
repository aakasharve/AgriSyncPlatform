// spec: dfes-companion-2026-07-11 (wave-4.4)

using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Work;

namespace ShramSafal.Application.UseCases.Work.GetWorkerReputation;

/// <summary>
/// The only read designed to leave the farm that recorded the work — <b>tiers 2 and 3, and
/// nothing else.</b> Founder model, 2026-08-17.
///
/// <para>Patil Farms wants to hire Ramesh. This is what it gets: what ARVE Farms chose to
/// say about him, and the count Shram Safal itself stands behind. It gets none of ARVE's
/// farm data — no plot, no crop, no spray, no dose, no cost. Those live behind
/// <c>GetWorkerProfileHandler</c> and <c>GetJobCardsForWorkerHandler</c>, which are tier 1
/// and refuse to travel at all.</para>
///
/// <para>Why the shape matters: <b>a reference letter can be written by a friend, and a
/// number can be invented. This can be neither.</b> Tier 2 is signed by a named farm, so a
/// reader can weigh who is speaking. Tier 3 is nobody's claim — it falls out of work
/// already recorded. Together they let Ramesh carry standing he actually earned, without
/// carrying ARVE's business with him.</para>
///
/// <para>It fails closed. Nothing can grant WORKER_RECORD_PORTABILITY today, so a caller
/// who shares no farm with him gets 403 and a caller who shares one gets only that farm's
/// half — which is what he could already see.</para>
/// </summary>
public sealed class GetWorkerReputationHandler(
    IShramSafalRepository repository,
    ILogger<GetWorkerReputationHandler> logger)
{
    public async Task<Result<WorkerReputationDto>> HandleAsync(
        GetWorkerReputationQuery query,
        CancellationToken ct = default)
    {
        var callerFarmIds = await repository.GetFarmIdsForUserAsync(query.CallerUserId.Value, ct);
        var workerFarmIds = await repository.GetFarmIdsForUserAsync(query.WorkerUserId.Value, ct);

        // Founder ruling, 2026-08-17 — two farms of his own are one owner's own record.
        var callerOwnedFarmIds = await repository
            .GetOwnedFarmIdsForUserAsync(query.CallerUserId.Value, ct);

        // The worker's own consent, and only his. An owner's consent is never an answer to
        // this question: the standing is the worker's, so the licence has to be his too.
        var portabilityConsent = await repository
            .HasWorkerRecordPortabilityConsentAsync(query.WorkerUserId, ct);

        // Tiers 2 and 3 travel on the same single fact — his recorded consent — so one
        // decision covers both. They are distinct tiers because they are distinct KINDS of
        // claim (his employer's opinion vs. the system's own count), not because they are
        // gated differently today. If they ever need different gates, split this call in
        // two; the guard already takes the tier per call.
        var access = WorkerRecordPortability.DecideAggregateScope(
            tier: WorkerRecordTier.EmployerStatement,
            callerUserId: query.CallerUserId.Value,
            workerUserId: query.WorkerUserId.Value,
            callerFarmIds: callerFarmIds,
            callerOwnedFarmIds: callerOwnedFarmIds,
            workerFarmIds: workerFarmIds,
            requestedFarmId: null,
            workerConsentedToPortability: portabilityConsent);

        if (!access.IsAllowed)
        {
            logger.LogInformation(
                "GetWorkerReputation refused for worker {WorkerUserId} by caller {CallerUserId}: {DenyReason}.",
                query.WorkerUserId, query.CallerUserId, access.DenyReason);

            return Result.Failure<WorkerReputationDto>(
                access.DenyReason == WorkerRecordPortability.DenyReasons.NoSharedFarm
                    ? ShramSafalErrors.Forbidden
                    : ShramSafalErrors.WorkerRecordPortabilityForbidden);
        }

        var permitted = access.PermittedFarmIds.ToHashSet();

        // TIER 2 — the employers' own words, each still carrying the farm that wrote it.
        //
        // An empty list here is SILENCE, not a bad review and not a zero. Nothing writes
        // these yet (the repository says so out loud), so today it is always empty — and
        // "always empty" renders exactly the same as "this farm chose to say nothing",
        // which is the correct rendering of both.
        var statements = await repository.GetWorkerStatementsAsync(query.WorkerUserId, ct);
        var visibleStatements = statements
            .Where(s => permitted.Contains(s.FarmId.Value))
            .OrderByDescending(s => s.AuthoredAtUtc)
            .Select(s => new WorkerStatementDto(
                FarmId: s.FarmId.Value,
                FarmName: s.FarmName,
                AuthoredByUserId: s.AuthoredByUserId.Value,
                Remark: s.Remark,
                AuthoredAtUtc: s.AuthoredAtUtc))
            .ToList();

        // TIER 3 — derived from the real job-card rows and nothing else. Note what is NOT
        // read here: GetWorkerMetricsAsync, whose ReliabilityScore is a stub returning
        // zeros. A zero dressed as a score is exactly the fabricated number P4 forbids, and
        // it would be the worst possible thing to make portable.
        var jobCards = await repository.GetJobCardsForWorkerAsync(query.WorkerUserId, ct);
        var derived = WorkerDerivedCounts.FromJobCards(
            jobCards, query.WorkerUserId, access.PermittedFarmIds);

        return Result.Success(new WorkerReputationDto(
            WorkerUserId: query.WorkerUserId.Value,
            Statements: visibleStatements,
            CompletedTasks: derived.CompletedTasks,
            FieldWorkHours: derived.FieldWorkHours,
            CrossedFarmBoundary: access.CrossedFarmBoundary));
    }
}
