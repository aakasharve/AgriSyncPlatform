using System.Security.Cryptography;
using System.Text;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Consent;

namespace ShramSafal.Application.UseCases.Consent.RecordConsentGateAcceptance;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-4.2) — <b>one tap, two records.</b>
///
/// <para>Founder decision 17. The farmer presses one button; this writes
/// <c>TERMS_ACCEPTED</c> into <c>ssf.terms_acceptance_events</c> AND
/// <c>CORE_DPDP_CONSENT_GRANTED</c> into <c>ssf.consent_grant_events</c> as two distinct
/// rows in two distinct tables, in one SaveChanges. Both or neither: a tap that recorded
/// the contract and lost the consent would leave us holding data on a legal basis that
/// does not exist.</para>
///
/// <para><b>Why the hash is computed here.</b> The command carries the notice TEXT. If
/// the client sent a digest, the digest would attest only that the client is consistent
/// with itself; computed server-side it is the server's own statement about the words the
/// farmer was shown. SHA-256, hex, lower case.</para>
///
/// <para><b>What is refused, and why loudly.</b> A missing age declaration, a blank
/// session id, an empty purpose list, a notice text that is absent or implausibly long.
/// The endpoint is ANONYMOUS by necessity — consent has to precede the account — so it is
/// the only validation there is. A refused command writes nothing and the gate keeps the
/// farmer where he is; it never returns success on a row that did not land.</para>
///
/// <para><b>Not claimed:</b> DPDP compliance. Six disclosures the founder still owes are
/// rendered on the notice as visible placeholders (see the client's
/// <c>consentNotice.ts</c>). This handler records what was shown, honestly, including
/// that it was incomplete — which is the most a record can do.</para>
/// </summary>
public sealed class RecordConsentGateAcceptanceHandler(
    IShramSafalRepository repository,
    IIdGenerator ids,
    IClock clock)
{
    /// <summary>
    /// Guard against an anonymous caller filling the ledger with megabytes of text. The
    /// real notice is a few kilobytes; this is generous by an order of magnitude and is
    /// still a bound.
    /// </summary>
    public const int MaxNoticeTextLength = 64 * 1024;

    public async Task<Result<ConsentGateAcceptanceResult>> HandleAsync(
        RecordConsentGateAcceptanceCommand cmd, CancellationToken ct = default)
    {
        // The 18+ declaration is MANDATORY on the screen and mandatory here. An
        // under-18 policy is one of the six disclosures still outstanding, so until it
        // lands the only honest posture is to record an explicit adult declaration and
        // refuse everything else.
        if (!cmd.AgeDeclaredAdult) return Result.Failure<ConsentGateAcceptanceResult>(ShramSafalErrors.InvalidCommand);

        if (string.IsNullOrWhiteSpace(cmd.PreRegistrationSessionId)
            || string.IsNullOrWhiteSpace(cmd.DisplayedLanguage)
            || string.IsNullOrWhiteSpace(cmd.NoticeVersion)
            || string.IsNullOrWhiteSpace(cmd.PrivacyPolicyVersion)
            || string.IsNullOrWhiteSpace(cmd.TermsVersion)
            || string.IsNullOrWhiteSpace(cmd.AppVersion)
            || cmd.AcceptedPurposeCodes.Count == 0
            || cmd.DataCategoryCodes.Count == 0)
        {
            return Result.Failure<ConsentGateAcceptanceResult>(ShramSafalErrors.InvalidCommand);
        }

        if (string.IsNullOrWhiteSpace(cmd.DisplayedNoticeText)
            || cmd.DisplayedNoticeText.Length > MaxNoticeTextLength)
        {
            return Result.Failure<ConsentGateAcceptanceResult>(ShramSafalErrors.InvalidCommand);
        }

        if (!TryParseSource(cmd.Source, out var source))
        {
            return Result.Failure<ConsentGateAcceptanceResult>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;   // SERVER time. A device clock is not a legal fact.
        var facts = new ConsentLedgerFacts(
            UserId: cmd.UserId,
            PreRegistrationSessionId: cmd.PreRegistrationSessionId.Trim(),
            NoticeVersion: cmd.NoticeVersion.Trim(),
            PrivacyPolicyVersion: cmd.PrivacyPolicyVersion.Trim(),
            TermsVersion: cmd.TermsVersion.Trim(),
            DisplayedLanguage: cmd.DisplayedLanguage.Trim(),
            AcceptedPurposeCodes: string.Join(',', cmd.AcceptedPurposeCodes),
            DataCategoryCodes: string.Join(',', cmd.DataCategoryCodes),
            Source: source,
            AppVersion: cmd.AppVersion.Trim(),
            NoticeHash: HashNotice(cmd.DisplayedNoticeText));

        var terms = TermsAcceptanceEvent.Accept(ids.New(), facts, now);
        var grant = ConsentGrantEvent.GrantCore(ids.New(), facts, now);

        await repository.AddTermsAcceptanceEventAsync(terms, ct);
        await repository.AddConsentGrantEventAsync(grant, ct);
        // ONE flush. Both rows land or the whole request fails and the farmer stays on
        // the gate — never a contract recorded without the consent that legitimises it.
        await repository.SaveChangesAsync(ct);

        return Result.Success(new ConsentGateAcceptanceResult(terms.Id, grant.Id));
    }

    /// <summary>Hex SHA-256 of the notice exactly as displayed, UTF-8.</summary>
    public static string HashNotice(string displayedNoticeText)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(displayedNoticeText))).ToLowerInvariant();

    private static bool TryParseSource(string? raw, out ConsentRecordSource source)
    {
        source = ConsentRecordSource.Web;
        if (string.Equals(raw, "app", StringComparison.OrdinalIgnoreCase))
        {
            source = ConsentRecordSource.App;
            return true;
        }

        // Anything unrecognised is REFUSED rather than defaulted. "web" is a fact about
        // where the acceptance happened; guessing it would put a false fact on a legal row.
        return string.Equals(raw, "web", StringComparison.OrdinalIgnoreCase);
    }
}
