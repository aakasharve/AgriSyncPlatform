using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.GetWorkerProfile;

public sealed record GetWorkerProfileQuery(
    UserId WorkerUserId,
    UserId CallerUserId,
    Guid? ScopedFarmId = null,
    // lane MU-3 fix 2 (N1) — false (an installed 1.0.17, any caller that does not say): earnings that would be
    // withheld refuse the page instead (1.0.17 draws a null as "0k").
    bool ClientShowsWithheldPay = false);
