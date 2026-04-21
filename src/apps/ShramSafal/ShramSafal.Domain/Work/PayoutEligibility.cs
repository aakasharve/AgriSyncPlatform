namespace ShramSafal.Domain.Work;

public sealed record PayoutEligibility(
    bool IsEligible,
    string? ReasonEn,
    string? ReasonMr);
