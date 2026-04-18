using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.CorrectCostEntry;

public sealed class CorrectCostEntryHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    private const decimal MaxSupportedAmount = 999_999_999m;

    public async Task<Result<FinanceCorrectionDto>> HandleAsync(CorrectCostEntryCommand command, CancellationToken ct = default)
    {
        if (command.CostEntryId == Guid.Empty ||
            command.CorrectedByUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.Reason))
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.InvalidCommand);
        }

        if (IsAmountOutOfRange(command.CorrectedAmount))
        {
            return Result.Failure<FinanceCorrectionDto>(CreateInvalidAmountError());
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

        var actorRole = await repository.GetUserRoleForFarmAsync((Guid)entry.FarmId, command.CorrectedByUserId, ct);
        if (actorRole is not AppRole.PrimaryOwner and not AppRole.SecondaryOwner)
        {
            return Result.Failure<FinanceCorrectionDto>(ShramSafalErrors.Forbidden);
        }
        var resolvedActorRole = actorRole.Value;

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

        // Repository add methods only stage entities; the single SaveChangesAsync call below is
        // the atomic EF Core commit point for both the correction and its audit event.
        await repository.AddFinanceCorrectionAsync(correction, ct);
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                entry.FarmId,
                "CostEntry",
                entry.Id,
                "Corrected",
                command.CorrectedByUserId,
                resolvedActorRole.ToString(),
                new
                {
                    costEntryId = entry.Id,
                    financeCorrectionId = correction.Id,
                    correction.OriginalAmount,
                    correction.CorrectedAmount,
                    correction.CurrencyCode,
                    correction.Reason
                },
                command.ClientCommandId,
                clock.UtcNow),
            ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(correction.ToDto());
    }

    private static bool IsAmountOutOfRange(decimal amount) =>
        amount <= 0 || amount > MaxSupportedAmount;

    private static Error CreateInvalidAmountError() =>
        new("ShramSafal.InvalidAmount", "Amount must be greater than zero and no more than 999999999.");
}
