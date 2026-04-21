namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Input DTO for a single job card line item supplied by the client.
/// CEI Phase 4 §4.8 — Work Trust Ledger.
/// </summary>
public sealed record JobCardLineItemDto(
    string ActivityType,
    decimal ExpectedHours,
    decimal RatePerHourAmount,
    string RatePerHourCurrencyCode,
    string? Notes);
