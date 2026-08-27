namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 12) —
/// lean list/picker projection of a
/// <see cref="ShramSafal.Domain.Labour.FieldOperator"/> for
/// <c>GET /farms/{farmId}/labour/field-operators</c>.
///
/// <para>
/// Deliberately a DIFFERENT (smaller) shape than <see cref="FieldOperatorDto"/>
/// — the write-side response Create/Rename already return, which also
/// carries <c>OriginatingFarmId</c>/<c>CreatedByUserId</c>/<c>CreatedAtUtc</c>
/// audit fields. This is a second type rather than a reuse of
/// <see cref="FieldOperatorDto"/> so the list endpoint's contract does not
/// drag write-side audit fields the picker UI never needs, and so a future
/// change to one shape cannot silently break the other's three existing
/// handler tests (Create/Attach/Rename).
/// </para>
/// <para>
/// <see cref="Id"/> is work identity only — never a <c>UserId</c> and never
/// linked to one (see <c>FieldOperator</c>'s class remarks). Never exposes
/// <c>DisplayNameNormalized</c> — that field is search/suggestion-only and
/// must never be treated as an identity field.
/// </para>
/// </summary>
public sealed record FieldOperatorSummaryDto(
    Guid Id,
    string DisplayName,
    string? FullName,
    bool IsActive);
