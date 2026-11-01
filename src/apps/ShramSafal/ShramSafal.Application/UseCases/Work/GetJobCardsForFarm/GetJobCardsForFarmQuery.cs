using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Work;

namespace ShramSafal.Application.UseCases.Work.GetJobCardsForFarm;

public sealed record GetJobCardsForFarmQuery(
    FarmId FarmId,
    UserId CallerUserId,
    JobCardStatus? StatusFilter,
    // lane MU-3 fix 2 (N1) — the phone shows a withheld pay as withheld (ClientContract.ShowsWithheldPay). False (an
    // installed 1.0.17, any caller that does not say) = a list that would carry a withheld pay is refused instead.
    bool ClientShowsWithheldPay = false);
