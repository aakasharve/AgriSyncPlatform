using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Reports.GetFarmWeekMis;

/// <summary>
/// Phase 6 Owner MIS — returns the per-farm weekly MIS snapshot from mis.*
/// materialized views. Gated by:
///   1. Farm membership (any member can read)
///   2. Entitlement: MisRead feature (Trialing or Active subscription required)
///
/// Returns the latest refreshed data — typically last night's nightly refresh.
/// If the farm has no analytics data yet (just onboarded), returns a zero-state
/// DTO rather than an error so the frontend can show the "no data yet" state.
/// </summary>
public sealed class GetFarmWeekMisHandler(
    IShramSafalRepository repository,
    IMisReportRepository misRepo,
    IEntitlementPolicy entitlementPolicy)
{
    public async Task<Result<FarmWeekMisDto>> HandleAsync(
        GetFarmWeekMisQuery query,
        CancellationToken ct = default)
    {
        if (query.FarmId == Guid.Empty || query.ActorUserId == Guid.Empty)
        {
            return Result.Failure<FarmWeekMisDto>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(query.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<FarmWeekMisDto>(ShramSafalErrors.FarmNotFound);
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(query.FarmId, query.ActorUserId, ct);
        if (!isMember)
        {
            return Result.Failure<FarmWeekMisDto>(ShramSafalErrors.Forbidden);
        }

        var gate = await EntitlementGate.CheckAsync<FarmWeekMisDto>(
            entitlementPolicy,
            new UserId(query.ActorUserId),
            new FarmId(query.FarmId),
            PaidFeature.MisRead,
            ct);
        if (gate is not null) return gate;

        var snapshot = await misRepo.GetFarmWeekMisAsync(query.FarmId, ct);

        // Zero-state: farm onboarded but no analytics yet — return empty snapshot
        // so frontend shows onboarding nudge instead of error.
        snapshot ??= new FarmWeekMisDto(
            FarmId: query.FarmId,
            Wvfd: 0,
            EngagementTier: "D",
            MedianVerifyLagHours: null,
            CorrectionRatePct: null,
            VoiceSharePct: null,
            ScheduleCompliancePct: null,
            UnscheduledLogPct: null,
            AiCostUsd7d: null);

        return Result.Success(snapshot);
    }
}
