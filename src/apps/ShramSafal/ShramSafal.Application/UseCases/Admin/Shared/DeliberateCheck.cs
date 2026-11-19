using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Admin.Shared;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, C24, lifted to one place by C32). Which verification
/// events are a person's deliberate check. Read by the one-farm page (<c>AdminFarmerHealthRepository</c>, P4, P6) and
/// by confirmed farm-days (<see cref="GetWvfdHistory.ConfirmedFarmDays"/>, W1-W7, F4, F5), so both use the same
/// markers. The markers are the <see cref="DailyLog"/> constants, never copied strings.
/// </summary>
public static class DeliberateCheck
{
    /// <summary>
    /// Reasons that mark a <c>Confirmed</c> or <c>Verified</c> event as NOT a person's deliberate check: the
    /// self-attestation written when an entry is saved, its bulk backfill, the intermediate confirmation of a
    /// two-hop entry, a speaker's mark on their own entry, and a mark by someone without confirm authority.
    /// </summary>
    public static IReadOnlyList<string?> NotADeliberateCheckReasons { get; } =
    [
        DailyLog.SelfAttestationReason,
        DailyLog.BackfilledAttestationReason,
        DailyLog.EnRouteConfirmReason,
        DailyLog.SpeakerOwnMarkReason,
        DailyLog.NoConfirmAuthorityMarkReason,
    ];

    /// <summary>Of those, the markers meaning "checked only by the person who saved it" (C24, P6).</summary>
    public static IReadOnlyList<string?> SelfCheckReasons { get; } =
    [
        DailyLog.SelfAttestationReason,
        DailyLog.BackfilledAttestationReason,
        DailyLog.SpeakerOwnMarkReason,
    ];

    /// <summary>
    /// A <c>Confirmed</c> or <c>Verified</c> event whose reason is null or none of
    /// <see cref="NotADeliberateCheckReasons"/>. Who made it (a test account, the entry's own saver) is for the
    /// caller to rule on.
    /// </summary>
    public static bool IsDeliberateCheck(VerificationStatus status, string? reason) =>
        (status == VerificationStatus.Confirmed || status == VerificationStatus.Verified)
        && !NotADeliberateCheckReasons.Contains(reason);
}
