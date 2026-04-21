using ShramSafal.Domain.Work;

namespace ShramSafal.Application.UseCases.Work.SettleJobCardPayout;

public sealed record SettleJobCardPayoutResult(
    Guid CostEntryId,
    JobCardStatus JobCardStatus);
