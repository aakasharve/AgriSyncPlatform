using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1 rule, shared by lane OF-S) — THE one rule for who may
/// change a SAVED record: an edit to what Sathi understood (<c>revise_log_content</c>) and a move of its place or
/// day (<c>move_daily_log</c>) both ask this, so the two can never drift into two permission systems.
///
/// <list type="number">
/// <item>A member of the RECORD's farm (E4: the farm is read from the log, never from the payload).</item>
/// <item>The farm may write records (<see cref="PaidFeature.WriteDailyLog"/>).</item>
/// <item>The person who recorded it, or anyone the ONE labour permission system allows
/// (<see cref="LabourManagementGate"/>: owner tier by role, जबाबदारी grant holders).</item>
/// <item>A record saved at the हजेरी door holds labour only (B002): it is changed in the हजेरी वही, never here —
/// refused with a three-segment <c>.InvalidCommand</c> so the phone parks the queued change where the farmer sees it.</item>
/// </list>
/// Every refusal comes back BEFORE anything is staged.
/// </summary>
public static class LogEditGate
{
    /// <summary>The refusal, or <c>null</c> when <paramref name="actorUserId"/> may change <paramref name="log"/>.</summary>
    public static async Task<Error?> CheckAsync(
        IShramSafalRepository repository,
        IEntitlementPolicy entitlementPolicy,
        DailyLog log,
        Guid actorUserId,
        DateTime nowUtc,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(log);

        var farmId = (Guid)log.FarmId;
        if (!await repository.IsUserMemberOfFarmAsync(farmId, actorUserId, ct))
        {
            return ShramSafalErrors.Forbidden;
        }

        var entitlement = await EntitlementGate.CheckErrorAsync(
            entitlementPolicy, new UserId(actorUserId), new FarmId(farmId), PaidFeature.WriteDailyLog, ct);
        if (entitlement is not null)
        {
            return entitlement;
        }

        var isCreator = actorUserId == log.OperatorUserId.Value;
        if (!isCreator && !await LabourManagementGate.IsAllowedAsync(repository, farmId, actorUserId, nowUtc, ct))
        {
            return ShramSafalErrors.Forbidden;
        }

        return log.WasCapturedAtLabourDoor ? ShramSafalErrors.LabourDoorLogContent : null;
    }
}
