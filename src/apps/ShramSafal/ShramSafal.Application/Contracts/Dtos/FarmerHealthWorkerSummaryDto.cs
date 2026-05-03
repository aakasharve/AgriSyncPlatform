namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// One row from the WTL v0 worker summary panel — top 5 workers seen on
/// a farm, ordered by descending <see cref="AssignmentCount"/>. Captured
/// passively from voice-log transcripts (<c>WorkerNameProjector</c> per
/// DWC v2 §2.10) — there is no farmer-facing API that creates these.
/// </summary>
/// <remarks>
/// <para>
/// Source: <c>ssf.workers</c> rows for the farm, ordered by
/// <c>assignment_count DESC LIMIT 5</c>.
/// </para>
/// <para>
/// <see cref="Name"/> is the raw extracted Marathi name and may include
/// honorifics — the UI renders it with <c>'Noto Sans Devanagari'</c>.
/// First-names only per <c>ADMIN_REDACTION_MATRIX.md</c> coverage of
/// <c>FarmerHealth</c>.
/// </para>
/// </remarks>
public sealed record FarmerHealthWorkerSummaryDto(
    Guid WorkerId,
    string Name,
    int AssignmentCount,
    DateTimeOffset FirstSeenUtc);
