using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Labour.AttachFieldOperator;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 11) —
/// attaches a known <c>FieldOperator</c> (<see cref="FieldOperatorId"/>) to a
/// <c>LabourAssignment</c> engagement (<see cref="LabourAssignmentId"/>), i.e.
/// records that named person worked it. See
/// <c>AttachFieldOperatorHandler</c>'s file header for why <see cref="FarmId"/>
/// — the farm established for this request — is asserted against BOTH
/// referenced rows before any write happens.
/// </summary>
public sealed record AttachFieldOperatorCommand(
    FarmId FarmId,
    Guid FieldOperatorId,
    Guid LabourAssignmentId,
    UserId CallerUserId);
