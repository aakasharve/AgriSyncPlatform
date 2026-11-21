using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Application.UseCases.Admin.GetFarmerHealth;

/// <summary>
/// One-farm page handler — returns the farm's page, scope-checked,
/// audit-logged, and redacted. A repository failure is not caught: it
/// escapes to the server's error path (500), never an empty page.
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
/// <item>Repository <c>GetAsync</c> — returns <c>null</c> when the farm is
///   outside <see cref="AdminScope"/> (checked against
///   <c>mis.effective_org_farm_scope</c> for a non-platform caller) or does
///   not exist.</item>
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
    IAdminAuditEmitter audit,
    IControlRoomHistory history,
    IControlRoomStore controlRoomStore,
    IAnalyticsRecordingCheck? recording = null)
{
    public async Task<Result<FarmerHealthDto>> HandleAsync(GetFarmerHealthQuery q, CancellationToken ct = default)
    {
        var dto = await repo.GetAsync(q.FarmId, q.Scope, q.ActorUserId, ct);
        if (dto is null)
        {
            return Result.Failure<FarmerHealthDto>(
                Error.NotFound("farmer_health.not_found", "Farm not in scope or does not exist."));
        }

        await audit.EmitFarmerLookupAsync(q.Scope, q.FarmId, "ModeA_Drilldown", ct);
        var redacted = redactor.Redact(dto, q.Scope, ModuleKey.FarmerHealth);

        // spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-N9): the closure columns and errors per day come from
        // analytics.events; while the store is not recording the page says so (set after redaction, which rebuilds the
        // record from its constructor). The check is optional only for hand-built test handlers.
        if (recording is not null)
        {
            var state = await recording.CheckAsync(q.ActorUserId, ct);
            if (!state.IsRecording)
            {
                redacted = redacted with
                {
                    AnalyticsNotMeasuredReason = AnalyticsRecording.NotRecordingReason,
                    AnalyticsStoppedAtUtc = state.StoppedAtUtc,
                };
            }
        }

        // spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4). The phone is set AFTER redaction: hidden unless
        // the seat holds the farmer_phones tick; otherwise the look is written to History before it is returned.
        if (!ControlRoomPhones.MayRead(q.Scope))
        {
            return Result.Success(redacted with { Phone = ControlRoomPhones.Hidden });
        }

        if (ControlRoomPhones.IsReal(redacted.Phone))
        {
            await ControlRoomPhones.RecordLookAsync(
                history, controlRoomStore, q.ActorUserId, q.AuditDeviceId, q.AuditIpHash,
                "farm_page", [q.FarmId], personCount: 0, count: 1, ct);
        }

        return Result.Success(redacted);
    }
}
