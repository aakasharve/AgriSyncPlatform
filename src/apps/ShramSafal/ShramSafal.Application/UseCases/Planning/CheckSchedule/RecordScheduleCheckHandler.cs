using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.CheckSchedule;

/// <param name="Decision"><c>Approved | Returned | Withdrawn</c> (case-insensitive; <c>Approve | Return | Withdraw</c> also read).</param>
/// <param name="CheckedActivityIds">Every activity of the row the checker ticked (R4); Approve needs ALL of them.</param>
public sealed record RecordScheduleCheckCommand(
    Guid CallerUserId,
    Guid TemplateId,
    string Decision,
    IReadOnlyList<Guid>? CheckedActivityIds,
    string? Note,
    string CheckerDisplayName,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");

public sealed record RecordScheduleCheckResult(
    Guid CheckId,
    Guid TemplateId,
    int TemplateVersion,
    string Decision,
    string State,
    DateTime CheckedAtUtc);

/// <summary>
/// spec: plr-d10 lane SCH-A (Task 4; founder D-74, L8-R) - records ShramSafal's check of one library row: an APPEND-ONLY
/// server record of who, when and which version. The checker comes from the AUTHENTICATED caller (never a body field), and the
/// caller must hold the platform review seat (<see cref="IEntitlementResolver.MayCheckSchedulesAsync"/>): a farm's owner, a
/// farm seat with <c>AppRole.Agronomist</c>, an FPO owner and the Platform Analyst are all refused (403). Only a Public
/// library row can be checked (a farmer's private or team copy is not ShramSafal's to check, and is answered as unknown). The
/// audit row (<c>schedule.checked</c>) carries exactly <c>{ templateId, templateVersion, decision }</c>: no note, no activity
/// names, no checker name.
/// </summary>
public sealed class RecordScheduleCheckHandler(
    IShramSafalRepository repository,
    IEntitlementResolver entitlements,
    IClock clock)
{
    public async Task<Result<RecordScheduleCheckResult>> HandleAsync(
        RecordScheduleCheckCommand command, CancellationToken ct = default)
    {
        if (command.CallerUserId == Guid.Empty || command.TemplateId == Guid.Empty)
        {
            return Result.Failure<RecordScheduleCheckResult>(ShramSafalErrors.InvalidCommand);
        }

        var caller = new UserId(command.CallerUserId);
        if (!await entitlements.MayCheckSchedulesAsync(caller, ct))
        {
            return Result.Failure<RecordScheduleCheckResult>(ShramSafalErrors.Forbidden);
        }

        var template = await repository.GetScheduleTemplateByIdAsync(command.TemplateId, ct);
        if (template is null || template.TenantScope != TenantScope.Public)
        {
            return Result.Failure<RecordScheduleCheckResult>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        var decision = ParseDecision(command.Decision);
        if (decision is null)
        {
            return Result.Failure<RecordScheduleCheckResult>(Error.Validation(
                "ShramSafal.ScheduleCheckDecision", "The decision must be Approved, Returned or Withdrawn."));
        }

        var now = clock.UtcNow;
        ScheduleCheckProblem? problem;
        var check = decision switch
        {
            ScheduleCheckDecision.Approved => ScheduleCheck.Approve(
                template, command.CheckedActivityIds ?? [], caller, command.CheckerDisplayName, now, out problem),
            ScheduleCheckDecision.Returned => ScheduleCheck.Return(
                template, command.Note, caller, command.CheckerDisplayName, now, out problem),
            _ => ScheduleCheck.Withdraw(
                template, command.Note, caller, command.CheckerDisplayName, now, out problem),
        };

        if (check is null)
        {
            return Result.Failure<RecordScheduleCheckResult>(Error.Validation(
                $"ShramSafal.{problem!.Code}", problem.Message));
        }

        await repository.AddScheduleCheckAsync(check, ct);

        var audit = AuditEventFactory.Create(
            entityType: "ScheduleTemplate",
            entityId: template.Id,
            action: "schedule.checked",
            actorUserId: command.CallerUserId,
            actorRole: "platform",
            // Exactly this, and nothing else: no note, no activity names, no checker name.
            payload: new { templateId = template.Id, templateVersion = template.Version, decision = check.Decision.ToString() },
            farmId: null,
            clientCommandId: null,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: null);
        await repository.AddAuditEventAsync(audit, ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new RecordScheduleCheckResult(
            check.Id, template.Id, template.Version, check.Decision.ToString(),
            ScheduleCheck.StateOf([check]).ToString(), check.CheckedAtUtc));
    }

    private static ScheduleCheckDecision? ParseDecision(string? wire) => wire?.Trim().ToLowerInvariant() switch
    {
        "approved" or "approve" => ScheduleCheckDecision.Approved,
        "returned" or "return" => ScheduleCheckDecision.Returned,
        "withdrawn" or "withdraw" => ScheduleCheckDecision.Withdrawn,
        _ => null,
    };
}

/// <summary>A schedule that stores its days and has no decision yet.</summary>
public sealed record WaitingScheduleDto(
    Guid Id,
    string Name,
    int Version,
    string? CropKey,
    string? OwnerType,
    string? SourceLabel,
    int StageCount,
    int ActivityCount,
    DateTime CreatedAtUtc);

/// <summary>
/// spec: plr-d10 lane SCH-A (Task 4) - <c>GET /shramsafal/schedule-templates/checks/waiting</c>: the Public library rows that
/// store their days and have no decision yet (a row with a decision - Checked, Returned or Withdrawn - is not waiting; an
/// edited copy is a NEW row and waits again). Platform review seat only (read on <c>schedules.review</c>).
/// </summary>
public sealed class GetSchedulesWaitingForCheckHandler(
    IShramSafalRepository repository,
    IEntitlementResolver entitlements)
{
    public async Task<Result<IReadOnlyList<WaitingScheduleDto>>> HandleAsync(Guid callerUserId, CancellationToken ct = default)
    {
        if (callerUserId == Guid.Empty)
        {
            return Result.Failure<IReadOnlyList<WaitingScheduleDto>>(ShramSafalErrors.InvalidCommand);
        }

        if (!await entitlements.MayReadScheduleChecksAsync(new UserId(callerUserId), ct))
        {
            return Result.Failure<IReadOnlyList<WaitingScheduleDto>>(ShramSafalErrors.Forbidden);
        }

        var rows = (await repository.GetScheduleTemplatesAsync(ct))
            .Where(t => t.TenantScope == TenantScope.Public && t.HasStoredDays)
            .ToList();
        var decided = (await repository.GetScheduleChecksAsync(rows.Select(r => r.Id).ToList(), ct))
            .Select(c => c.ScheduleTemplateId)
            .ToHashSet();

        IReadOnlyList<WaitingScheduleDto> waiting = rows
            .Where(r => !decided.Contains(r.Id))
            .OrderBy(r => r.CreatedAtUtc)
            .Select(r => new WaitingScheduleDto(
                r.Id, r.Name, r.Version, r.CropKey,
                r.OwnerType is { } owner ? ScheduleOwnerTypeWire.ToWire(owner) : null,
                r.SourceLabel, r.StageRows.Count, r.Activities.Count, r.CreatedAtUtc))
            .ToList();
        return Result.Success(waiting);
    }
}
