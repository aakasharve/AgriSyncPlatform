using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Work;

namespace ShramSafal.Application.UseCases.Work.GetJobCardsForWorker;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.2.1.
/// Returns the job cards assigned to a specific worker on farms the caller shares with him.
/// The caller must either be the worker themselves or a farm member of one of the worker's farms.
///
/// <para>spec: dfes-companion-2026-07-11 (wave-4.4) — <b>this is a TIER 1 read, and the
/// purest example of one.</b> A job card names the plot, the crop activity, the rate and
/// the hours the farm planned: "what he did at ARVE Farms in exact things", which the
/// founder said Patil Farms must never see. It used to return EVERY job card on ANY farm
/// to any caller who shared just one farm with him.</para>
///
/// <para><b>No consent opens it.</b> The detail on these cards is the farm's business
/// record; the worker was never in a position to license it away. What he CAN license —
/// his employer's word about him, and the counts Shram Safal derives — lives in
/// <c>GetWorkerReputationHandler</c>. Names stay: inside a shared farm the caller still
/// sees exactly what he saw before. See <see cref="WorkerRecordTier"/>.</para>
/// </summary>
public sealed class GetJobCardsForWorkerHandler(IShramSafalRepository repository)
{
    public async Task<Result<List<JobCardDto>>> HandleAsync(
        GetJobCardsForWorkerQuery query,
        CancellationToken ct = default)
    {
        var callerFarmIds = await repository.GetFarmIdsForUserAsync(query.CallerUserId.Value, ct);
        var workerFarmIds = await repository.GetFarmIdsForUserAsync(query.WorkerUserId.Value, ct);

        // Read and passed for completeness, but at tier 1 it cannot widen anything: the
        // guard ignores consent on this tier by construction. Kept as an explicit argument
        // so nobody reading this handler concludes the consent question was forgotten.
        var portabilityConsent = await repository
            .HasWorkerRecordPortabilityConsentAsync(query.WorkerUserId, ct);

        // The intersection of the two men's farms, and no more. A caller who belongs to
        // both farms has crossed nothing by seeing a list of rows from both — he already
        // stands inside each, and every row stays labelled with the farm it came from.
        var permittedFarmIds = WorkerRecordPortability.PermittedFarms(
            tier: WorkerRecordTier.FarmOperationalDetail,
            callerUserId: query.CallerUserId.Value,
            workerUserId: query.WorkerUserId.Value,
            callerFarmIds: callerFarmIds,
            workerFarmIds: workerFarmIds,
            workerConsentedToPortability: portabilityConsent);

        // No overlap at all is the pre-existing 403 — a stranger asking about a worker.
        if (permittedFarmIds.Count == 0)
        {
            return Result.Failure<List<JobCardDto>>(ShramSafalErrors.Forbidden);
        }

        // This endpoint takes no farm parameter, so the narrowing has to happen here
        // rather than being pushed into the query. The repository read stays unscoped by
        // design (a worker's own view needs all of it); the filter is what keeps another
        // farm's record of him from coming back with it.
        var permitted = permittedFarmIds.ToHashSet();
        var jobCards = await repository.GetJobCardsForWorkerAsync(query.WorkerUserId, ct);
        var dtos = jobCards
            .Where(j => permitted.Contains(j.FarmId.Value))
            .Select(j => j.ToJobCardDto())
            .ToList();

        return Result.Success(dtos);
    }
}
