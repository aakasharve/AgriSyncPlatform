using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Application.UseCases.Admin.GetFarmerHealth;

/// <summary>
/// Mode A drilldown handler — returns the per-farmer DWC v2 health
/// payload, scope-checked, audit-logged, and redacted.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.6 Step 1. The plan sketch uses MediatR
/// (<c>IRequest&lt;Result&lt;T&gt;&gt;</c>) but every other admin handler
/// in the codebase
/// (<see cref="GetFarmsList.GetFarmsListHandler"/>,
/// <see cref="GetSuffering.GetSufferingHandler"/>, etc.) uses a plain
/// <c>HandleAsync</c> method invoked directly by the endpoint. Following
/// the established convention rather than introducing MediatR for two
/// new handlers.
/// </para>
/// <para>
/// Pipeline:
/// </para>
/// <list type="number">
/// <item>Repository <c>GetAsync</c> — implementation joins
///   <c>mis.effective_org_farm_scope</c>, returning <c>null</c> when the
///   farm is outside <see cref="AdminScope"/>.</item>
/// <item>If <c>null</c> → <see cref="Result.Failure(Error)"/> with
///   <see cref="ErrorKind.NotFound"/>.</item>
/// <item>Emit <c>admin.farmer_lookup</c> audit event (best-effort —
///   emitter swallows its own failures).</item>
/// <item>Redact via <see cref="IResponseRedactor"/> against module key
///   <see cref="ModuleKey.FarmerHealth"/> before returning.</item>
/// </list>
/// </remarks>
public sealed class GetFarmerHealthHandler(
    IAdminFarmerHealthRepository repo,
    IResponseRedactor redactor,
    IAdminAuditEmitter audit)
{
    public async Task<Result<FarmerHealthDto>> HandleAsync(GetFarmerHealthQuery q, CancellationToken ct = default)
    {
        var dto = await repo.GetAsync(q.FarmId, q.Scope, ct);
        if (dto is null)
        {
            return Result.Failure<FarmerHealthDto>(
                Error.NotFound("farmer_health.not_found", "Farm not in scope or does not exist."));
        }

        await audit.EmitFarmerLookupAsync(q.Scope, q.FarmId, "ModeA_Drilldown", ct);
        var redacted = redactor.Redact(dto, q.Scope, ModuleKey.FarmerHealth);
        return Result.Success(redacted);
    }
}
