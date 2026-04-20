using ShramSafal.Domain.Location;

namespace ShramSafal.Application.UseCases.Finance.AddCostEntry;

public sealed record AddCostEntryCommand(
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    string Category,
    string Description,
    decimal Amount,
    string CurrencyCode,
    DateOnly EntryDate,
    Guid CreatedByUserId,
    LocationSnapshot? Location = null,
    Guid? CostEntryId = null,
    string? ActorRole = null,
    string? ClientCommandId = null);
