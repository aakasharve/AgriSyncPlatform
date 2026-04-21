using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Compliance;

namespace ShramSafal.Application.UseCases.Compliance.GetComplianceSignalsForFarm;

/// <summary>
/// CEI Phase 3 §4.6 — returns compliance signals for a farm ordered by
/// severity descending (Critical = 3 first), then LastSeenAtUtc descending.
/// </summary>
public sealed class GetComplianceSignalsForFarmHandler(IComplianceSignalRepository signalRepository)
{
    public async Task<Result<IReadOnlyList<ComplianceSignalDto>>> HandleAsync(
        GetComplianceSignalsForFarmQuery query,
        CancellationToken ct = default)
    {
        if (query is null || query.FarmId.IsEmpty)
            return Result.Failure<IReadOnlyList<ComplianceSignalDto>>(
                new Error("Compliance.InvalidCommand", "FarmId is required."));

        var signals = await signalRepository.GetForFarmAsync(
            query.FarmId,
            query.IncludeResolved,
            query.IncludeAcknowledged,
            ct);

        var dtos = signals
            .OrderByDescending(s => (int)s.Severity)
            .ThenByDescending(s => s.LastSeenAtUtc)
            .Select(MapToDto)
            .ToList();

        return Result.Success<IReadOnlyList<ComplianceSignalDto>>(dtos);
    }

    public static ComplianceSignalDto MapToDto(ComplianceSignal signal) =>
        new(
            Id: signal.Id,
            FarmId: (Guid)signal.FarmId,
            PlotId: signal.PlotId,
            CropCycleId: signal.CropCycleId,
            RuleCode: signal.RuleCode,
            Severity: signal.Severity.ToString(),
            SuggestedAction: signal.SuggestedAction.ToString(),
            TitleEn: signal.TitleEn,
            TitleMr: signal.TitleMr,
            DescriptionEn: signal.DescriptionEn,
            DescriptionMr: signal.DescriptionMr,
            PayloadJson: signal.PayloadJson,
            FirstSeenAtUtc: signal.FirstSeenAtUtc,
            LastSeenAtUtc: signal.LastSeenAtUtc,
            AcknowledgedAtUtc: signal.AcknowledgedAtUtc,
            ResolvedAtUtc: signal.ResolvedAtUtc,
            ResolutionNote: signal.ResolutionNote,
            IsOpen: signal.IsOpen);
}
