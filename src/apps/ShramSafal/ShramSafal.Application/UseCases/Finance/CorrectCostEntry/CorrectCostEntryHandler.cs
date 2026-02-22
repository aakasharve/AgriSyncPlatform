using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.CorrectCostEntry;

public sealed class CorrectCostEntryHandler(
    IShramSafalRepository repository,
    IAuthorizationEnforcer authorizationEnforcer,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<FinanceCorrectionDto>> HandleAsync(CorrectCostEntryCommand command, CancellationToken ct = default)
    {
        if (command.CostEntryId == Guid.Empty ||
            command.CorrectedByUserId == Guid.Empty ||
            command.CorrectedAmount <= 0 ||
            string.IsNullOrWhiteSpace(command.Reason))
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.FinanceCorrectionId.HasValue && command.FinanceCorrectionId.Value == Guid.Empty)
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.InvalidCommand);
        }

        var entry = await repository.GetCostEntryByIdAsync(command.CostEntryId, ct);
        if (entry is null)
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.CostEntryNotFound);
        }

        await authorizationEnforcer.EnsureIsFarmMember(new UserId(command.CorrectedByUserId), entry.FarmId);

        var correction = Domain.Finance.FinanceCorrection.Create(
            command.FinanceCorrectionId ?? idGenerator.New(),
            entry.Id,
            entry.Amount,
            command.CorrectedAmount,
            command.CurrencyCode,
            command.Reason,
            command.CorrectedByUserId,
            clock.UtcNow);

        entry.MarkCorrected(correction.Id, correction.CorrectedAmount, correction.CurrencyCode, correction.CorrectedAtUtc);

        await repository.AddFinanceCorrectionAsync(correction, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(correction.ToDto());
    }
}
