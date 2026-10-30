// spec: data-principle-spine-2026-05-05/06.2
//
// Sub-phase 06.2 — read-side fetch of the live UserConsentState row.
// Returns a default-shaped result (all-false toggles, version 1, null
// timestamps) when the user has never interacted with the consent flow,
// so the client can render the screen without distinguishing "no row"
// from "default row". No audit emission on a read.
//
// plr-d10 I25 (founder D-13, D-31) — also says which notice is in force, which notice
// this person last accepted, and which words his "keep my original voice" choice was made
// under. All ADDITIVE: an old phone ignores them, and none of them can make this read fail.

using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Consent;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.UseCases.Consent.GetConsent;

/// <param name="callerScope">
/// Runs the notice-acceptance read as the caller (the ledger's self-only RLS policy needs
/// it). Optional so existing direct constructions keep compiling; without it the accepted
/// notice is reported as unknown (null), which a phone treats as "ask".
/// </param>
public sealed class GetConsentHandler(
    IShramSafalRepository repository,
    ICallerUserTenantScope? callerScope = null,
    ILogger<GetConsentHandler>? logger = null)
{
    public async Task<Result<GetConsentResult>> HandleAsync(
        Guid userId,
        CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
        {
            return Result.Failure<GetConsentResult>(ShramSafalErrors.JoinUnauthenticated);
        }

        var state = await repository.GetUserConsentStateAsync(userId, ct).ConfigureAwait(false);

        // No row yet → return the implicit default surface so the UI
        // can render "all consents off, version 1, never granted" the
        // same way it would render a real row.
        state ??= UserConsentState.Create(userId);

        // Read-side only: when the current continuous grant of the voice
        // full-history purpose began. Not stored, not mutated.
        DateTime? grantedSince = state.FullHistoryJournal
            ? await repository.GetFullHistoryCurrentGrantStartUtcAsync(userId, ct).ConfigureAwait(false)
            : null;

        var accepted = await ReadAcceptedNoticeAsync(userId, ct).ConfigureAwait(false);

        return Result.Success(new GetConsentResult(
            UserId: state.UserId,
            FullHistoryJournal: state.FullHistoryJournal,
            CrossFarmAggregation: state.CrossFarmAggregation,
            ResearchCorpusExport: state.ResearchCorpusExport,
            Version: state.Version,
            GrantedAtUtc: state.GrantedAtUtc,
            WithdrawnAtUtc: state.WithdrawnAtUtc,
            FullHistoryJournalGrantedSinceUtc: grantedSince,
            CurrentNoticeVersion: CurrentConsentWording.NoticeVersion,
            AcceptedNoticeVersion: accepted?.NoticeVersion,
            NoticeAcceptedAtUtc: accepted?.RecordedAtUtc,
            FullHistoryJournalWordingVersion: state.FullHistoryJournalWordingVersion));
    }

    /// <summary>
    /// Enrichment, never a gate: every phone (1.0.15 onward) reads this endpoint, so a
    /// failure here must not turn the whole consent read into an error. On failure the
    /// accepted notice is reported as unknown — the answer that makes a phone ASK, never the
    /// one that makes it skip asking — and the failure is logged, not swallowed.
    /// </summary>
    private async Task<TermsAcceptanceEvent?> ReadAcceptedNoticeAsync(Guid userId, CancellationToken ct)
    {
        if (callerScope is null)
        {
            return null;
        }

        try
        {
            return await callerScope
                .RunForCallerAsync(userId, token => repository.GetLatestNoticeAcceptanceAsync(userId, token), ct)
                .ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger?.LogWarning(ex,
                "GET /consent/me: the accepted notice version could not be read; reporting it as unknown.");
            return null;
        }
    }
}
