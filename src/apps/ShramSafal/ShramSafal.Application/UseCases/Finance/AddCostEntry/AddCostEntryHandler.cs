using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.AddCostEntry;

public sealed class AddCostEntryHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    private const int DuplicateWindowMinutes = 120;
    private const decimal HighAmountThreshold = 25000m;
    private const string HighAmountFlagReason = "High amount: >= 25000 INR";

    public async Task<Result<AddCostEntryResultDto>> HandleAsync(AddCostEntryCommand command, CancellationToken ct = default)
    {
        var farmId = new FarmId(command.FarmId);

        if (command.FarmId == Guid.Empty ||
            command.CreatedByUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.Category) ||
            command.Amount <= 0)
        {
            return Result.Failure<AddCostEntryResultDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.CostEntryId.HasValue && command.CostEntryId.Value == Guid.Empty)
        {
            return Result.Failure<AddCostEntryResultDto>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<AddCostEntryResultDto>(ShramSafalErrors.FarmNotFound);
        }

        var canWriteFarm = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.CreatedByUserId, ct);
        if (!canWriteFarm)
        {
            return Result.Failure<AddCostEntryResultDto>(ShramSafalErrors.Forbidden);
        }

        if (command.PlotId is not null)
        {
            var plot = await repository.GetPlotByIdAsync(command.PlotId.Value, ct);
            if (plot is null || plot.FarmId != farmId)
            {
                return Result.Failure<AddCostEntryResultDto>(ShramSafalErrors.PlotNotFound);
            }
        }

        if (command.CropCycleId is not null)
        {
            var cropCycle = await repository.GetCropCycleByIdAsync(command.CropCycleId.Value, ct);
            if (cropCycle is null || cropCycle.FarmId != farmId)
            {
                return Result.Failure<AddCostEntryResultDto>(ShramSafalErrors.CropCycleNotFound);
            }
        }

        var candidateId = command.CostEntryId ?? idGenerator.New();
        var entry = Domain.Finance.CostEntry.Create(
            candidateId,
            command.FarmId,
            command.PlotId,
            command.CropCycleId,
            command.Category,
            command.Description,
            command.Amount,
            command.CurrencyCode,
            command.EntryDate,
            command.CreatedByUserId,
            command.Location,
            clock.UtcNow);

        var duplicateCandidates = await repository.GetCostEntriesForDuplicateCheck(
            farmId,
            command.PlotId,
            command.Category,
            clock.UtcNow.AddMinutes(-DuplicateWindowMinutes),
            ct);

        var isPotentialDuplicate = Domain.Finance.DuplicateDetector.IsPotentialDuplicate(
            duplicateCandidates,
            entry,
            DuplicateWindowMinutes);

        if (entry.Amount >= HighAmountThreshold)
        {
            entry.Flag(HighAmountFlagReason);
        }

        await repository.AddCostEntryAsync(entry, ct);
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                command.FarmId,
                "CostEntry",
                entry.Id,
                "Created",
                command.CreatedByUserId,
                command.ActorRole ?? "unknown",
                new
                {
                    entry.Id,
                    command.FarmId,
                    command.PlotId,
                    command.CropCycleId,
                    command.Category,
                    command.Amount,
                    command.CurrencyCode,
                    command.EntryDate,
                    command.Location
                },
                command.ClientCommandId,
                clock.UtcNow),
            ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(new AddCostEntryResultDto(entry.ToDto(), isPotentialDuplicate));
    }
}
