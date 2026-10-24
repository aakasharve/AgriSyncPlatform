using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Labour.DeactivateFieldOperator;

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves (Team actions) — retires a named worker
/// (<c>FieldOperator</c>) from the farm's live list. NOT a delete: the row, every
/// attendance mark, every work row and every name snapshot stay exactly as they
/// were, so history keeps reading. NOT an account or subscription action — a
/// work identity has neither.
/// </summary>
public sealed record DeactivateFieldOperatorCommand(
    FarmId FarmId,
    Guid FieldOperatorId,
    UserId CallerUserId);
