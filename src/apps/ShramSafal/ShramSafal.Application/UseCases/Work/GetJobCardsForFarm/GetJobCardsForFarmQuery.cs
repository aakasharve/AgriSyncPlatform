using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Work;

namespace ShramSafal.Application.UseCases.Work.GetJobCardsForFarm;

public sealed record GetJobCardsForFarmQuery(
    FarmId FarmId,
    UserId CallerUserId,
    JobCardStatus? StatusFilter);
