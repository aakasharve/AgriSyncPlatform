namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Sync-state sub-block of the Mode A drilldown payload. Surfaces the
/// most recent sync-error rows for a farm so an ops admin can spot a
/// device that is failing pushes silently.
/// </summary>
/// <remarks>
/// <para>
/// Per <c>ADMIN_REDACTION_MATRIX.md</c> the entire sub-block requires
/// the <c>ops:read</c> claim on the caller's <c>AdminScope</c>; for
/// callers without that claim the handler omits this property (sets it
/// to <c>null</c>).
/// </para>
/// </remarks>
public sealed record FarmerHealthSyncStateDto(
    DateTime? LastSyncAt,
    int PendingPushes,
    int FailedPushesLast7d,
    IReadOnlyList<FarmerHealthSyncErrorDto> LastErrors);

/// <summary>One row in <see cref="FarmerHealthSyncStateDto.LastErrors"/>.</summary>
public sealed record FarmerHealthSyncErrorDto(
    DateTime Ts,
    string Endpoint,
    int Status,
    string Message);

/// <summary>
/// AI-invocation health sub-block of the Mode A drilldown payload. Same
/// <c>ops:read</c> gating discipline as
/// <see cref="FarmerHealthSyncStateDto"/>.
/// </summary>
public sealed record FarmerHealthAiHealthDto(
    decimal VoiceParseSuccessRate14d,
    decimal ReceiptParseSuccessRate14d,
    int InvocationCount14d);

/// <summary>
/// Verification state counts for a farm (last 14 days). Counts are
/// always returned — verification state itself is not PII.
/// </summary>
public sealed record FarmerHealthVerificationCountsDto(
    int Confirmed,
    int Verified,
    int Disputed,
    int Pending);
