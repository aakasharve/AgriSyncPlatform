namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Last-activity sub-block of the one-farm page (P8).
/// </summary>
/// <remarks>
/// <para>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 3, C21). Only the last-activity time is sent: the
/// latest <c>sync.completed</c> or <c>log.created</c> row of this farm in <c>analytics.events</c>, unchanged; null
/// when there is none. The failed-push count and the last errors are not sent (P9 stays "Not built yet": a refused
/// upload does not record its farm), nor the device queue depth, which the server cannot see.
/// </para>
/// </remarks>
public sealed record FarmerHealthSyncStateDto(
    DateTime? LastSyncAt);

/// <summary>
/// Voice and photo reading on one farm, the last 14 India days (P10, P11), one block per kind of job in
/// <c>ssf.ai_jobs</c>: <see cref="Voice"/> (<c>VoiceToStructuredLog</c>), <see cref="Receipt"/>
/// (<c>ReceiptToExpenseItems</c>) and <see cref="Patti"/> (<c>PattiImageToSaleData</c>).
/// </summary>
public sealed record FarmerHealthAiHealthDto(
    FarmerHealthReadingDto Voice,
    FarmerHealthReadingDto Receipt,
    FarmerHealthReadingDto Patti);

/// <summary>
/// One kind of reading job on one farm in the last 14 India days.
/// </summary>
/// <remarks>
/// <list type="bullet">
/// <item><see cref="FinishedJobs14d"/> (P11): jobs that finished, read or failed, by the status rule of the
///   company voice saved share (<c>CompanyMisCalculator.IsFinishedJobStatus</c>). A true zero is 0.</item>
/// <item><see cref="SavedJobs14d"/>: of those, the jobs an entry of this farm was saved from. Null when the kind
///   records no link from a saved record back to its job (<see cref="SavedNotRecorded"/>).</item>
/// <item><see cref="SavedPct14d"/> (P10): saved ÷ finished × 100, one decimal. Null exactly when
///   <see cref="NotMeasuredReason"/> is set: <c>denominator_zero</c> (no finished job, never 0% or 100%) or
///   <see cref="SavedNotRecorded"/>.</item>
/// </list>
/// Jobs started by a test account (<c>CompanyMis:ExcludedUserIds</c>) and entries saved by one are left out.
/// </remarks>
public sealed record FarmerHealthReadingDto(
    int FinishedJobs14d,
    int? SavedJobs14d,
    decimal? SavedPct14d,
    string? NotMeasuredReason)
{
    /// <summary>
    /// A receipt or patti photo read is never linked to what was saved from it: a cost entry synced from the phone
    /// carries no job id, and a patti has no saved record type. So their saved share cannot be counted.
    /// </summary>
    public const string SavedNotRecorded = "saved_not_recorded";
}

/// <summary>
/// Checks on this farm's entries (P6): each entry saved in the last 14 India days, counted once by its LATEST
/// verification status. <see cref="Pending"/> is "waiting for a check": latest status <c>Draft</c> or
/// <c>CorrectionPending</c>, or no verification event yet. Entries saved by a test account are left out.
/// </summary>
public sealed record FarmerHealthVerificationCountsDto(
    int Confirmed,
    int Verified,
    int Disputed,
    int Pending);
