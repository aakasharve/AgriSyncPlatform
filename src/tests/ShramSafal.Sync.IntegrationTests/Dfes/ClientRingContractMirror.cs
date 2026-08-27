// spec: dfes-companion-2026-07-11 (wave-1.3)
using System;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.3) — A MIRROR OF TWO CLIENT FUNCTIONS.
///
/// <para><b>Read this before trusting anything below.</b> This is a C# MIRROR of
/// TypeScript that lives in <c>src/clients/mobile-web/</c>. It is NOT the client. A
/// backend test that drives this mirror proves the SERVER emits a string the mirror
/// counts — it does not, on its own, prove the client counts it, because editing the
/// TypeScript cannot make a C# copy fail.</para>
///
/// <para><b>What makes the mirror worth anything</b> is <c>ClientRingContractDriftTests</c>,
/// which reads the two real <c>.ts</c> files off disk, parses the mapping and the counted
/// set out of them, and fails if this mirror has drifted from either. Delete that suite and
/// this file silently degrades to a comment. The mirror exists because
/// <c>src/clients/**</c> is outside the backend implementor's allowlist; the drift guard
/// exists because a copy nobody checks is worse than no copy at all.</para>
/// </summary>
internal static class ClientRingContractMirror
{
    /// <summary>Path, from the repo root, of the function <see cref="MapVerificationStatus"/> mirrors.</summary>
    public const string MapVerificationStatusSourcePath =
        "src/clients/mobile-web/src/features/sync/pull/helpers/mapVerificationStatus.ts";

    /// <summary>Path, from the repo root, of the set <see cref="TheRingCountsIt"/> mirrors.</summary>
    public const string DayStateSourcePath =
        "src/clients/mobile-web/src/shared/utils/dayState.ts";

    /// <summary>
    /// Mirrors <c>mapVerificationStatus(status?: string)</c> — what
    /// <c>logsReconciler.toDailyLog</c> feeds <c>DailyLogDto.lastVerificationStatus</c>
    /// into before writing <c>DailyLog.verification.status</c> to Dexie.
    /// Returns the <c>LogVerificationStatus</c> member NAME.
    /// </summary>
    public static string MapVerificationStatus(string? status)
    {
        if (string.IsNullOrEmpty(status))
        {
            return "DRAFT";
        }

        var normalized = System.Text.RegularExpressions.Regex
            .Replace(status.Trim(), "([a-z])([A-Z])", "$1_$2");
        normalized = System.Text.RegularExpressions.Regex
            .Replace(normalized, "[\\s-]+", "_")
            .ToLowerInvariant();

        return normalized switch
        {
            "draft" or "pending" => "DRAFT",
            "confirmed" or "auto_approved" => "CONFIRMED",
            "approved" or "verified" => "VERIFIED",
            "rejected" or "disputed" => "DISPUTED",
            "correction_pending" => "CORRECTION_PENDING",
            _ => "DRAFT",
        };
    }

    /// <summary>
    /// Mirrors <c>VERIFIED_STATUSES</c> — the set <c>computeDayState</c> consults when
    /// deciding whether a log closes the day. CONFIRMED is deliberately NOT in it:
    /// <c>ReviewInboxSheet.tsx:40-45</c> still shows a CONFIRMED log as waiting for
    /// review, so counting it as done would have the ring and the inbox contradicting
    /// each other about the same log.
    /// </summary>
    public static bool TheRingCountsIt(string localStatus)
        => localStatus is "VERIFIED" or "APPROVED";
}
