using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.GetJobCardsForWorker;

public sealed record GetJobCardsForWorkerQuery(
    UserId WorkerUserId,
    UserId CallerUserId);
