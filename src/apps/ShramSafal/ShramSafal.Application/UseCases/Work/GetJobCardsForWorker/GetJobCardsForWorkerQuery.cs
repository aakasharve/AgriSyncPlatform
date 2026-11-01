using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.GetJobCardsForWorker;

public sealed record GetJobCardsForWorkerQuery(
    UserId WorkerUserId,
    UserId CallerUserId,
    // lane MU-3 fix 2 (N1) — see GetJobCardsForFarmQuery.ClientShowsWithheldPay.
    bool ClientShowsWithheldPay = false);
