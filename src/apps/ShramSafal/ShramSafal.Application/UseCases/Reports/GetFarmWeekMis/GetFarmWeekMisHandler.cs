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
///   1. Farm membership, and the farm overview: a seat that reads only his own records gets none (lane F99 fix pass 1)
///   2. Entitlement: MisRead feature (Trialing or Active subscription required)
///
/// Returns the latest refreshed data — typically last night's nightly refresh.
/// If the farm has no analytics data yet (just onboarded), returns a zero-state
/// DTO rather than an error so the frontend can show the "no data yet" state.
/// </summary>
public sealed class GetFarmWeekMisHandler(
    IShramSafalRepository repository,
    IMisReportRepository misRepo,
    IEntitlementPolicy entitlementPolicy,
    IClock clock)
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

        // spec: plr-d10 lane F99 fix pass 1 (review F-2; MU-3) — the weekly report IS the farm's overview (verified days,
        // engagement, verify lag, corrections, schedule compliance): a seat that reads only his own records (the कामगार
        // label, the स्वतःचं काम scope) is not sent it, as the pull does not send him the attention board
        // (FarmReadScope.SeeFarmOverview). And its AI cost is money: only a seat that sees money gets it.
        var readScope = await Services.FarmReadGate.ScopeAsync(repository, query.FarmId, query.ActorUserId, clock.UtcNow, ct);
        if (readScope is not { SeeFarmOverview: true })
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

        // Withheld (null, never a made-up 0) from a seat that does not see money — the same null the zero-state sends.
        return Result.Success(readScope.SeeMoney ? snapshot : snapshot with { AiCostUsd7d = null });
    }
}
