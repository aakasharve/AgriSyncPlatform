namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 11) — wire
/// projection of a <see cref="ShramSafal.Domain.Labour.FieldOperator"/>. A durable
/// human work subject (Task 9), deliberately NOT a user account — <see cref="Id"/>
/// is work identity only; it is never a <c>UserId</c> and never linked to one.
/// </summary>
public sealed record FieldOperatorDto(
    Guid Id,
    string DisplayName,
    string? FullName,
    Guid OriginatingFarmId,
    Guid CreatedByUserId,
    DateTime CreatedAtUtc,
    bool IsActive);
