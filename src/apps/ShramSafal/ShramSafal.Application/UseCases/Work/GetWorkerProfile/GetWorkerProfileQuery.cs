using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.GetWorkerProfile;

public sealed record GetWorkerProfileQuery(
    UserId WorkerUserId,
    UserId CallerUserId,
    Guid? ScopedFarmId = null);
