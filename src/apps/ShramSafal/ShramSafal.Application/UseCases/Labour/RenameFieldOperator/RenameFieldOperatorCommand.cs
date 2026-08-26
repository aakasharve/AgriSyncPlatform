using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Labour.RenameFieldOperator;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 11) —
/// renames a <c>FieldOperator</c> going forward only. Never touches any
/// existing <c>FieldOperatorWorkRow.DisplayNameAtAttach</c> snapshot (Task 9's
/// <c>FieldOperator.Rename</c> / Task 10's attribution overlay).
/// </summary>
public sealed record RenameFieldOperatorCommand(
    FarmId FarmId,
    Guid FieldOperatorId,
    string DisplayName,
    UserId CallerUserId);
