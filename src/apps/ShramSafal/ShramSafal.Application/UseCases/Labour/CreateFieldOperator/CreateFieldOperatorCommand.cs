using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Labour.CreateFieldOperator;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 11) —
/// mints a new <see cref="ShramSafal.Domain.Labour.FieldOperator"/> work
/// identity on <see cref="FarmId"/>.
/// </summary>
/// <param name="FarmId">
/// The farm <c>ICallerFarmTenantScope.EstablishForCallerAsync</c> established
/// for this request. The resulting <c>FieldOperator.OriginatingFarmId</c> is
/// set to exactly this value — never re-derived from "the caller's farm",
/// since multi-farm-per-login is a core product invariant (a caller may own
/// or belong to several farms at once).
/// </param>
/// <param name="ClientOperatorId">
/// Optional client-chosen id for the new work identity. When present it IS the
/// operator's id, which makes the create idempotent: a retry after a lost response
/// (or a double tap) returns the same person instead of minting a second one. Two
/// different people with the same NAME are still two rows (B2) — idempotency keys on
/// the id, never on the name. Null keeps the original server-minted behaviour.
/// </param>
public sealed record CreateFieldOperatorCommand(
    FarmId FarmId,
    string DisplayName,
    string? FullName,
    UserId CallerUserId,
    Guid? ClientOperatorId = null);
