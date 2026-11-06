using ShramSafal.Application.Ports;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 / D-43).
/// THE ONE rule for a farm's own price and rate list: who may set it, and who may read which rate. The push door, the REST
/// doors and the pull all ask here, so the doors cannot drift apart (the F101 defect class).
///
/// <list type="bullet">
/// <item><b>Write — part A:</b> the farm's PRIMARY ACCOUNT HOLDER only (<see cref="FarmAccessPolicy.IsPrimaryAccountHolder"/>:
/// the registrant, or an Active seat labelled PrimaryOwner — the single D-26 rule for people and permissions). Part B
/// (the grantable "दर ठरवण्याची परवानगी", optionally until a date) widens <see cref="MayWriteRatesAsync"/> and nothing else.</item>
/// <item><b>Read:</b> an input's price with see money; a work / service rate is PAY (D-67 / D-69 keep money and pay apart),
/// so it needs see wages as well. The primary account holder reads both. Rates are the FARM's: a seat's plots (MU-4) do not
/// narrow them and no rate has a per-record audience (PRV) — orchestrator ruling, reversible.</item>
/// <item><b>Own records only reads none</b> (fix round 1, review F1; CTO ruling): a seat that reads only its own records —
/// the कामगार label or the स्वतःचं काम scope (<see cref="FarmReadScope.OwnRecordsOnly"/>) — receives no rate of the farm, even
/// holding see money and see wages. The server's own permission card tells the owner those two are "लागू नाही" for such a
/// seat (<c>LabourPermissionProjection</c>), and <c>RecordVisibility</c> §11.7 / MU G1 keep other people's money and pay
/// from it; a farm's price and wage list is exactly that.</item>
/// </list>
/// </summary>
public static class FarmRateGate
{
    /// <summary>May <paramref name="userId"/> set (or stop) the rates of <paramref name="farmId"/>?</summary>
    public static Task<bool> MayWriteRatesAsync(
        IShramSafalRepository repository, Guid farmId, Guid userId, CancellationToken ct = default) =>
        FarmAuthorityGate.IsPrimaryAccountHolderAsync(repository, farmId, userId, ct);

    /// <summary>May a reader with <paramref name="scope"/> read a rate of <paramref name="kind"/>? No scope reads nothing.</summary>
    public static bool MayReadRate(FarmReadScope? scope, FarmRateKind kind) =>
        scope is not null
        && (scope.IsPrimaryAccountHolder
            || (!scope.OwnRecordsOnly && scope.SeeMoney && (kind == FarmRateKind.Input || scope.SeeWages)));

    /// <summary>Does this scope read ANY of the farm's rates (the pull reads the table only for such farms)?</summary>
    public static bool MayReadAnyRate(FarmReadScope scope) => MayReadRate(scope, FarmRateKind.Input);
}
