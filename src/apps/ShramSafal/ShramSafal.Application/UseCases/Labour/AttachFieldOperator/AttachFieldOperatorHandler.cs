using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Labour;

namespace ShramSafal.Application.UseCases.Labour.AttachFieldOperator;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 11) —
/// attaches a known <see cref="FieldOperator"/> to a <c>LabourAssignment</c>
/// engagement (Task 10's attribution overlay: it records that named person
/// worked it, and never changes the engagement's reported headcount).
///
/// <para>
/// <b>WHY this handler does explicit both-sides authorization instead of
/// trusting that the caller can load the two rows.</b> RLS visibility is NOT
/// a cross-farm defence here, and the database will not save you — two
/// independently verified facts:
/// </para>
/// <list type="number">
/// <item>
/// <c>p_user_select_labour_assignments</c> (and the sibling
/// <c>p_user_select_field_operators</c> on the FieldOperator side) is a
/// PERMISSIVE Postgres RLS policy, OR-ed with the tenant policy — Postgres
/// combines multiple permissive policies with OR, never AND. For a
/// multi-farm login this GRANTS READ BEYOND the single farm
/// <c>ICallerFarmTenantScope</c> established for this request. So the fact
/// the caller CAN load a <c>LabourAssignment</c> or <see cref="FieldOperator"/>
/// by id does NOT mean the caller is authorised to attach it on THIS farm.
/// </item>
/// <item>
/// Postgres foreign-key checks bypass RLS entirely. A valid
/// <c>FieldOperatorId</c> / <c>LabourAssignmentId</c> FK on the eventual
/// <c>FieldOperatorWorkRow</c> insert only proves the referenced row EXISTS
/// somewhere in the table — never that the caller may touch it.
/// </item>
/// </list>
/// <para>
/// So this handler loads the <c>LabourAssignment</c>, loads its PARENT
/// <c>DailyLog</c>, and asserts <c>dailyLog.FarmId == command.FarmId</c>;
/// separately loads the <see cref="FieldOperator"/> and asserts
/// <c>OriginatingFarmId == command.FarmId</c>. EITHER failure — including
/// either row simply not existing — returns <see cref="ShramSafalErrors.Forbidden"/>
/// with ZERO writes, deliberately never <c>NotFound</c>: a distinct
/// "not found" response would let a forged id from another farm be used to
/// probe existence. Do not "simplify" this into a single existence check or
/// drop it as "redundant with RLS" — that is exactly the gap this handler
/// exists to close, and Task 14 attacks it from both directions
/// adversarially.
/// </para>
/// <para>
/// <b>This handler is also self-sufficient about the CALLER, not just the
/// rows.</b> Before either row-farm check, it re-checks that
/// <c>command.CallerUserId</c> is a member of <c>command.FarmId</c> at all
/// (mirrors <c>CreateFieldOperatorHandler</c>). The HTTP route is the only
/// construction site today, so <c>ICallerFarmTenantScope</c> already proved
/// this — but that is circumstance, not a guarantee this handler can lean
/// on: <c>PushSyncBatchHandler</c> is a documented multi-farm write surface
/// that is skip-listed from the tenant middleware (no <c>agrisync.farm_id</c>
/// GUC, so the <c>p_tenant_field_operator_work_rows</c> WITH CHECK backstop
/// is not in play either) and dispatches per-mutation handlers with
/// client-supplied ids. A handler that only checked the rows would be wide
/// open the day attribution reaches sync, with no compile-time and no
/// test-time signal.
/// </para>
/// </summary>
public sealed class AttachFieldOperatorHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
    : IHandler<AttachFieldOperatorCommand, AttachFieldOperatorResult>
{
    public async Task<Result<AttachFieldOperatorResult>> HandleAsync(
        AttachFieldOperatorCommand command, CancellationToken ct = default)
    {
        if (command.FarmId.IsEmpty || command.FieldOperatorId == Guid.Empty
            || command.LabourAssignmentId == Guid.Empty || command.CallerUserId.IsEmpty)
        {
            return Result.Failure<AttachFieldOperatorResult>(ShramSafalErrors.InvalidCommand);
        }

        // Defense-in-depth membership re-check — mirrors CreateFieldOperatorHandler
        // (the HTTP entry point already gates via ICallerFarmTenantScope, but
        // a handler invoked from any other surface must still fail closed).
        var callerRole = await repository.GetUserRoleForFarmAsync(
            command.FarmId.Value, command.CallerUserId.Value, ct);
        if (callerRole is null)
        {
            return Result.Failure<AttachFieldOperatorResult>(ShramSafalErrors.Forbidden);
        }

        // ── Side 1: the LabourAssignment's parent DailyLog belongs to THIS farm. ──
        var assignment = await repository.GetLabourAssignmentByIdAsync(command.LabourAssignmentId, ct);
        if (assignment is null)
        {
            return Result.Failure<AttachFieldOperatorResult>(ShramSafalErrors.Forbidden);
        }

        var dailyLog = await repository.GetDailyLogByIdAsync(assignment.DailyLogId, ct);
        if (dailyLog is null || dailyLog.FarmId != command.FarmId)
        {
            return Result.Failure<AttachFieldOperatorResult>(ShramSafalErrors.Forbidden);
        }

        // ── Side 2: the FieldOperator originated on THIS farm. ────────────────────
        var fieldOperator = await repository.GetFieldOperatorByIdAsync(command.FieldOperatorId, ct);
        if (fieldOperator is null || fieldOperator.OriginatingFarmId != command.FarmId)
        {
            return Result.Failure<AttachFieldOperatorResult>(ShramSafalErrors.Forbidden);
        }

        // 11.5 — snapshot the operator's CURRENT DisplayName now; a later
        // Rename must never rewrite this row (see FieldOperatorWorkRow's own
        // remarks). WorkDate is derived from the parent log, not the caller.
        FieldOperatorWorkRow row;
        try
        {
            row = FieldOperatorWorkRow.Create(
                idGenerator.New(),
                fieldOperator.Id,
                assignment.Id,
                command.FarmId,
                dailyLog.LogDate,
                fieldOperator.DisplayName,
                command.CallerUserId,
                clock.UtcNow);
        }
        catch (ArgumentException)
        {
            return Result.Failure<AttachFieldOperatorResult>(ShramSafalErrors.InvalidCommand);
        }

        // Idempotent by intent (11.5) — `false` means this (operator,
        // assignment) pair already existed. That is a SUCCESS, not an error;
        // a retried attach yields one row and a success both times.
        var inserted = await repository.TryAddFieldOperatorWorkRowAsync(row, ct);

        return Result.Success(new AttachFieldOperatorResult(
            fieldOperator.Id, assignment.Id, AlreadyAttached: !inserted));
    }
}
