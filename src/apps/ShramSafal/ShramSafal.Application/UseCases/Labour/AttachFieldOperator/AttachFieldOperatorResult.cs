namespace ShramSafal.Application.UseCases.Labour.AttachFieldOperator;

/// <summary>
/// <c>AlreadyAttached</c> is <c>true</c> when this exact (FieldOperator,
/// LabourAssignment) pair was already attached by an earlier call — a
/// retried attach (Task 11.5, idempotent by intent). It is a SUCCESS
/// outcome, never an error; the caller still gets back the pair it asked to
/// attach.
/// </summary>
public sealed record AttachFieldOperatorResult(
    Guid FieldOperatorId,
    Guid LabourAssignmentId,
    bool AlreadyAttached);
