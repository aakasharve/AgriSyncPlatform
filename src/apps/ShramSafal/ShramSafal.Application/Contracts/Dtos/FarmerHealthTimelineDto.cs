namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// One India day of activity on one farm, for the 14-day timeline of the one-farm page.
/// </summary>
/// <remarks>
/// <para>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 3, C21). <see cref="Date"/> is an India day (fixed
/// +05:30, <c>GetCompanyMisHandler.IstDay</c>). Absent days are sent as a row of zeros so the grid keeps 14 cells;
/// every count below is a count of rows, so a zero is a true zero.
/// </para>
/// <list type="bullet">
/// <item><see cref="ClosuresStarted"/>, <see cref="ClosuresSubmitted"/>, <see cref="ProofAttached"/>,
///   <see cref="SummariesViewed"/> (P3): this farm's <c>closure.started</c>, <c>closure.submitted</c>,
///   <c>proof.attached</c>, <c>closure_summary.viewed</c> rows of <c>analytics.events</c>.</item>
/// <item><see cref="Verifications"/> (P4): distinct entries per India day that received a person's deliberate
///   check on this farm's entries, read as the app login through row-level security; the self-attestation and
///   en-route markers (C23/C24) and checks by a test account are left out. Not a count of Confirmed/Verified
///   events.</item>
/// <item><see cref="Errors"/> (P5): problems tied to this farm by the shared rule (<c>AdminErrorFarm.FarmSql</c>
///   and <c>CountedProblemSql</c>), the same rule All Farms, Suffering and Live Health count with.</item>
/// </list>
/// </remarks>
public sealed record FarmerHealthTimelineDto(
    DateOnly Date,
    int ClosuresStarted,
    int ClosuresSubmitted,
    int ProofAttached,
    int SummariesViewed,
    int Verifications,
    int Errors);
