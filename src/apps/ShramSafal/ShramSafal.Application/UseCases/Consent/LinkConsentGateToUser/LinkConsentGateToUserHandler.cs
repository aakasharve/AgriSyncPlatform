using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Consent.RecordConsentGateAcceptance;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Consent;

namespace ShramSafal.Application.UseCases.Consent.LinkConsentGateToUser;

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves (B1) — <b>the acceptance gets its owner.</b>
///
/// <para><b>The defect.</b> The DPDP consent gate renders only when
/// <c>!isAuthenticated</c>, so the accepting command's user id is always null and the row
/// lands with <c>user_id NULL</c>. The RLS policy on both ledgers reads
/// <c>USING (user_id IS NOT NULL AND user_id = &lt;GUC&gt;)</c>, so that row is visible to
/// no user, and <c>UPDATE</c>/<c>DELETE</c>/<c>TRUNCATE</c> are revoked so it can never be
/// attached to one. Consent was recorded and silently orphaned: no error, no alarm, and
/// nothing producible on a DPDP access request.</para>
///
/// <para><b>The fix (founder ruling 2026-08-27, option a).</b> One NEW row in each ledger,
/// <c>TERMS_ACCEPTANCE_LINKED</c> and <c>CORE_DPDP_CONSENT_LINKED</c>, carrying the account
/// id. Not an edit of the original — append-only is not an obstacle here, it is the
/// property that makes these tables a legal record, and a linkage is a state change like
/// any other.</para>
///
/// <para><b>Two rows, one flush.</b> Same posture as the accepting handler: both land or
/// neither does. A half-link would say the Terms belong to this account while the consent
/// that legitimises the data belongs to nobody.</para>
///
/// <para><b>Doctrine P9 — this can never reject a farmer's record.</b> Nothing in
/// registration or in the log-save path calls this handler; it is its own authenticated
/// endpoint, invoked after the account already exists, and no farmer-facing flow waits on
/// its result. When it fails it fails in place: the failure is logged with the session id
/// (below), the client keeps the pre-registration session id and calls again, and the
/// idempotency read makes that retry a no-op that returns the same two ids. So the honest
/// end state of a failure is "not linked yet, retry pending", never "the farmer is
/// blocked" and never "we reported success on a row that did not land".</para>
///
/// <para><b>What this row does NOT claim.</b> <c>RecordedAtUtc</c> is when the LINK
/// happened. The acceptance moment stays on the original row; stamping this one with the
/// earlier time would back-date a legal record to make the chain look tidier than it was.
/// And the facts are the client's re-statement of what it displayed — see the honesty note
/// on the corroboration gap at the bottom of this file.</para>
///
/// <para><b>Why the session id is wrapped in <c>LogSafe.Text</c> at all three log sites.</b>
/// <c>PreRegistrationSessionId</c> arrives from the client, so a newline in it would let a caller
/// append a line to the log that reads exactly like one we wrote. CodeQL flagged all three as
/// CWE-117 on PR #55. These are the audit trail of a DPDP record: a forged line here is worse
/// than a missing one, and a line the subject of the record can author is not a record. Nothing
/// is removed — the session id is still named, which is the whole point of the lines — it is only
/// defused. Note also what is NOT here: <c>DisplayedNoticeText</c>, the purpose codes and the data
/// category codes are never logged, and <c>LogSafe</c> could not have made them safe if they
/// were, because it sanitises and does not redact.</para>
/// </summary>
public sealed class LinkConsentGateToUserHandler(
    IShramSafalRepository repository,
    IIdGenerator ids,
    IClock clock,
    ILogger<LinkConsentGateToUserHandler> logger)
{
    public async Task<Result<ConsentGateLinkResult>> HandleAsync(
        LinkConsentGateToUserCommand cmd, CancellationToken ct = default)
    {
        // A linking row with no user attaches nothing to nobody — the defect this handler
        // exists to close. The domain factories throw on it; refuse here first so the
        // caller gets a Result rather than an exception (doctrine E2: the application asks
        // for an outcome).
        if (cmd.UserId == Guid.Empty)
        {
            return Refuse("no user id on the command", cmd.PreRegistrationSessionId);
        }

        // Same completeness bar as the accepting row, deliberately. The linking row is
        // evidence in its own right — it has to answer "what was this person shown?"
        // without the row it points at, because nothing can read that row.
        if (string.IsNullOrWhiteSpace(cmd.PreRegistrationSessionId)
            || string.IsNullOrWhiteSpace(cmd.DisplayedLanguage)
            || string.IsNullOrWhiteSpace(cmd.NoticeVersion)
            || string.IsNullOrWhiteSpace(cmd.PrivacyPolicyVersion)
            || string.IsNullOrWhiteSpace(cmd.TermsVersion)
            || string.IsNullOrWhiteSpace(cmd.AppVersion)
            || cmd.AcceptedPurposeCodes.Count == 0
            || cmd.DataCategoryCodes.Count == 0)
        {
            return Refuse("incomplete evidence", cmd.PreRegistrationSessionId);
        }

        if (string.IsNullOrWhiteSpace(cmd.DisplayedNoticeText)
            || cmd.DisplayedNoticeText.Length > RecordConsentGateAcceptanceHandler.MaxNoticeTextLength)
        {
            return Refuse("missing or oversized notice text", cmd.PreRegistrationSessionId);
        }

        if (!TryParseSource(cmd.Source, out var source))
        {
            return Refuse("unrecognised source", cmd.PreRegistrationSessionId);
        }

        var sessionId = cmd.PreRegistrationSessionId.Trim();

        // IDEMPOTENCY — this is what makes a failure retryable instead of blocking.
        //
        // The client cannot know whether a request that lost its response landed, so it
        // must be free to call again on the next app start, forever, until it sees a 200.
        // Both linking rows carry user_id = the caller, so unlike the orphaned accepting
        // row they ARE readable through the self policy — the reads below are the only
        // ones in this flow that RLS permits at all.
        //
        // Check-then-insert rather than an upsert, because both ledgers are append-only BY
        // PRIVILEGE (REVOKE UPDATE, DELETE, TRUNCATE — 20260816170524_AddConsentGateLedgers):
        // ON CONFLICT DO UPDATE is not available to agrisync_app on these tables at all.
        // Mirrors RecordQuestionEventHandler's replay read on ssf.question_events.
        var existingTerms = await repository.FindTermsAcceptanceLinkAsync(cmd.UserId, sessionId, ct);
        var existingGrant = await repository.FindConsentGrantLinkAsync(cmd.UserId, sessionId, ct);
        if (existingTerms is not null && existingGrant is not null)
        {
            logger.LogInformation(
                "Consent gate link replay for session {PreRegistrationSessionId}; both ledgers already "
                + "linked (terms {TermsEventId}, grant {GrantEventId}). Nothing written.",
                LogSafe.Text(sessionId), existingTerms.Id, existingGrant.Id);

            return Result.Success(new ConsentGateLinkResult(existingTerms.Id, existingGrant.Id, AlreadyLinked: true));
        }

        var now = clock.UtcNow;   // SERVER time, and it is the LINK's time, not the acceptance's.

        // The SAME hash function the accepting row used, CALLED rather than re-written. If
        // the two ever computed a digest differently, the accepting row and the linking row
        // would describe the same words with different hashes, and a reader years from now
        // could not tell they are about one acceptance. That is not a tidiness argument; it
        // is the evidentiary link between the two rows doing its job.
        var noticeHash = RecordConsentGateAcceptanceHandler.HashNotice(cmd.DisplayedNoticeText);

        var facts = new ConsentLedgerFacts(
            UserId: cmd.UserId,
            PreRegistrationSessionId: sessionId,
            NoticeVersion: cmd.NoticeVersion.Trim(),
            PrivacyPolicyVersion: cmd.PrivacyPolicyVersion.Trim(),
            TermsVersion: cmd.TermsVersion.Trim(),
            DisplayedLanguage: cmd.DisplayedLanguage.Trim(),
            AcceptedPurposeCodes: string.Join(',', cmd.AcceptedPurposeCodes),
            DataCategoryCodes: string.Join(',', cmd.DataCategoryCodes),
            Source: source,
            AppVersion: cmd.AppVersion.Trim(),
            NoticeHash: noticeHash);

        // Write only what is missing. In practice both are missing or both are present —
        // they are flushed together — but "linked in both ledgers" is the post-condition
        // that matters, and a half-linked account must be able to converge on a retry
        // rather than be told it is already done.
        var terms = existingTerms ?? TermsAcceptanceEvent.LinkToUser(ids.New(), facts, now);
        var grant = existingGrant ?? ConsentGrantEvent.LinkToUser(ids.New(), facts, now);

        if (existingTerms is null) await repository.AddTermsAcceptanceEventAsync(terms, ct);
        if (existingGrant is null) await repository.AddConsentGrantEventAsync(grant, ct);

        // ONE flush, both ledgers — never a Terms link without the consent link beside it.
        await repository.SaveChangesAsync(ct);

        logger.LogInformation(
            "Consent gate acceptance linked to a user for session {PreRegistrationSessionId} "
            + "(terms {TermsEventId}, grant {GrantEventId}).",
            LogSafe.Text(sessionId), terms.Id, grant.Id);

        return Result.Success(new ConsentGateLinkResult(terms.Id, grant.Id, AlreadyLinked: false));
    }

    /// <summary>
    /// Refuse, and say so where somebody can see it.
    ///
    /// <para>A refused link leaves an acceptance orphaned for longer, which is precisely the
    /// failure that went unnoticed for eleven days because nothing anywhere raised a sound.
    /// It is not a farmer-visible error and it must never become one (doctrine P9), so the
    /// landing place is a log line naming the session — enough to find the stuck acceptance
    /// later, and enough that "consent links are failing" is a question the logs can answer.
    /// The reason is a fixed string, never the notice text or any farmer content.</para>
    ///
    /// <para>The session id is client-supplied (CWE-117), so it goes through
    /// <c>LogSafe.Text</c>, which also subsumes the hand-rolled "(none supplied)" fallback this
    /// line used to carry: absent, empty and whitespace-only all collapse to
    /// <c>LogSafe.Unknown</c>. That is strictly more than the old ternary caught — a value made
    /// entirely of control characters used to render as a blank that reads "nothing was sent",
    /// and now says <c>unknown</c>, which is what a probe actually looks like.</para>
    /// </summary>
    private Result<ConsentGateLinkResult> Refuse(string reason, string? sessionId)
    {
        logger.LogWarning(
            "Refused consent gate link for session {PreRegistrationSessionId}: {Reason}. "
            + "The acceptance stays orphaned until a corrected call succeeds.",
            LogSafe.Text(sessionId?.Trim()), reason);

        return Result.Failure<ConsentGateLinkResult>(ShramSafalErrors.InvalidCommand);
    }

    /// <summary>
    /// Identical to the accepting handler's parse, and identically unforgiving: anything
    /// other than <c>app</c> or <c>web</c> is REFUSED rather than defaulted. Where an
    /// acceptance happened is a fact on a legal row, and guessing it would put a false
    /// fact there.
    /// </summary>
    private static bool TryParseSource(string? raw, out ConsentRecordSource source)
    {
        source = ConsentRecordSource.Web;
        if (string.Equals(raw, "app", StringComparison.OrdinalIgnoreCase))
        {
            source = ConsentRecordSource.App;
            return true;
        }

        return string.Equals(raw, "web", StringComparison.OrdinalIgnoreCase);
    }
}

// ── Honesty note: what this handler CANNOT verify ────────────────────────────────────
//
// It cannot confirm that the acceptance it is linking to ever happened. The orphaned row
// is unreadable by every role in this system (FORCE ROW LEVEL SECURITY; agrisync_admin has
// neither rolsuper nor rolbypassrls), so there is no server-side cross-check available —
// not a count, not a hash comparison, nothing. The linking row is therefore an
// authenticated account's re-statement of the notice it was shown, stamped by the server
// at link time, and it is labelled *_LINKED precisely so it is never mistaken for the
// acceptance itself.
//
// That is weaker than corroboration and it is stated plainly rather than papered over. It
// is still strictly better than the alternatives: a foreign key would point at a row
// nothing can dereference, and leaving the acceptance orphaned — the status quo — produces
// no record at all. Closing the gap properly needs a readable pre-registration surface,
// which is a schema decision and a founder call, not something to smuggle in here.
