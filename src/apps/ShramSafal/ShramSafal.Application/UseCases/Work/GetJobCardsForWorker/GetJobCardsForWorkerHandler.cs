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
/// <para>spec: dfes-companion-2026-07-11 (wave-4.4) — this used to return EVERY job card
/// assigned to the worker on ANY farm, to any caller who shared just one farm with him.
/// That is a work history following a man between employers, which founder ruling A
/// (2026-08-17) puts behind his own consent. Names stay: inside a shared farm the caller
/// still sees exactly what he saw before. See <see cref="WorkerRecordPortability"/>.</para>
/// </summary>
public sealed class GetJobCardsForWorkerHandler(IShramSafalRepository repository)
{
    public async Task<Result<List<JobCardDto>>> HandleAsync(
        GetJobCardsForWorkerQuery query,
        CancellationToken ct = default)
    {
        var callerFarmIds = await repository.GetFarmIdsForUserAsync(query.CallerUserId.Value, ct);
        var workerFarmIds = await repository.GetFarmIdsForUserAsync(query.WorkerUserId.Value, ct);

        // Fails closed — nothing grants this purpose today, so the permitted set is the
        // caller/worker farm intersection for everyone but the worker himself.
        var portabilityConsent = await repository
            .HasWorkerRecordPortabilityConsentAsync(query.WorkerUserId, ct);

        var permittedFarmIds = WorkerRecordPortability.PermittedFarms(
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
