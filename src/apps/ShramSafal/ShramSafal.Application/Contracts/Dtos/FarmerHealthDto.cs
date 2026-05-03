namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Mode A response root for <c>GET /admin/farmer-health/{farmId}</c>.
/// Combines DWC v2 score row + 14-day activity timeline + sync state +
/// AI invocation health + verification counts + WTL v0 worker summary.
/// Field shapes mirror <c>UI_DESIGN_BRIEF_GEMINI.md</c> §2 (TypeScript).
/// </summary>
/// <remarks>
/// <para>
/// PII / ops fields are gated by the redactor (per
/// <c>ADMIN_REDACTION_MATRIX.md</c> module <c>FarmerHealth</c>):
/// </para>
/// <list type="bullet">
/// <item><see cref="FarmerName"/>, <see cref="Phone"/> — require
///   <c>pii:read</c> claim; redacted to <c>**redacted**</c> /
///   <c>"98******12"</c> mask otherwise.</item>
/// <item><see cref="SyncState"/>, <see cref="AiHealth"/> — require
///   <c>ops:read</c> claim; null otherwise.</item>
/// <item><see cref="WorkerSummary"/> — first names only, capped at 5.</item>
/// </list>
/// </remarks>
public sealed record FarmerHealthDto(
    Guid FarmId,
    string FarmerName,
    string Phone,
    FarmerHealthScoreBreakdownDto Score,
    IReadOnlyList<FarmerHealthTimelineDto> Timeline,
    FarmerHealthSyncStateDto? SyncState,
    FarmerHealthAiHealthDto? AiHealth,
    FarmerHealthVerificationCountsDto Verifications,
    IReadOnlyList<FarmerHealthWorkerSummaryDto> WorkerSummary);
