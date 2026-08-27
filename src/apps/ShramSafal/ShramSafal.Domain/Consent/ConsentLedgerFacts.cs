namespace ShramSafal.Domain.Consent;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-4.2) — the facts BOTH legal records preserve.
///
/// <para>Founder decision 17: one visual acceptance button, <b>two separate legal
/// records</b>. They are separate tables and separate rows on purpose — a blanket
/// "accept everything forever" is not valid consent under DPDP, and accepting Terms is a
/// contractual act while granting consent is a data-protection one. Bundling them into a
/// single row would make it impossible to withdraw the consent while remaining bound by
/// the Terms, which is exactly the state a withdrawal produces.</para>
///
/// <para>Both rows carry the SAME evidence set, held here so the two can never drift:
/// who (or which pre-registration session), which notice, which policy and terms
/// versions, which language it was READ in, exactly which purposes and data categories
/// were accepted, when the SERVER saw it, from what, on which app build, and the hash of
/// the exact words displayed. That last one is what makes the record defensible years
/// later — a stored consent that cannot name the notice it was given against is an
/// assertion, not evidence.</para>
///
/// <para><b>Server time, never the client's.</b> A device clock is trivially wrong and
/// trivially set; a consent timestamp is a legal fact.</para>
/// </summary>
/// <param name="UserId">
/// The account, once there is one. NULL before registration — the gate runs BEFORE
/// login, so at write time there is frequently no account to point at. That is not a
/// defect: <paramref name="PreRegistrationSessionId"/> is the join key in that window.
/// </param>
/// <param name="PreRegistrationSessionId">
/// Stable id minted by the client on first open and kept. Always present, including for
/// a signed-in writer, so a pre-login row and a later post-login row can be lined up.
/// </param>
/// <param name="NoticeVersion">Version of the notice document displayed.</param>
/// <param name="PrivacyPolicyVersion">Version of the privacy policy in force.</param>
/// <param name="TermsVersion">Version of the Terms of Use in force.</param>
/// <param name="DisplayedLanguage">
/// The language the notice was READ in — not the account's preference. Under DPDP the
/// notice must be given in a language the principal understands, so which one was on
/// screen is part of the evidence.
/// </param>
/// <param name="AcceptedPurposeCodes">
/// Comma-separated purpose codes, in the order shown. Codes rather than prose so the row
/// stays readable after the copy is rewritten.
/// </param>
/// <param name="DataCategoryCodes">Comma-separated data-category codes.</param>
/// <param name="Source">Where the acceptance came from — <c>app</c> or <c>web</c>.</param>
/// <param name="AppVersion">Client build that displayed the notice.</param>
/// <param name="NoticeHash">
/// Hex SHA-256 of the exact displayed notice, computed SERVER-SIDE from the text the
/// client says it displayed. Server-side because a hash the client both produces and
/// asserts proves only that the client is consistent with itself.
/// </param>
public sealed record ConsentLedgerFacts(
    Guid? UserId,
    string PreRegistrationSessionId,
    string NoticeVersion,
    string PrivacyPolicyVersion,
    string TermsVersion,
    string DisplayedLanguage,
    string AcceptedPurposeCodes,
    string DataCategoryCodes,
    ConsentRecordSource Source,
    string AppVersion,
    string NoticeHash)
{
    /// <summary>
    /// Throws when a record would be written without the evidence that makes it a record.
    /// Every one of these is load-bearing: a row missing its notice hash, its versions or
    /// its language cannot answer "what was this person actually shown?".
    /// </summary>
    public void EnsureComplete()
    {
        Require(PreRegistrationSessionId, nameof(PreRegistrationSessionId));
        Require(NoticeVersion, nameof(NoticeVersion));
        Require(PrivacyPolicyVersion, nameof(PrivacyPolicyVersion));
        Require(TermsVersion, nameof(TermsVersion));
        Require(DisplayedLanguage, nameof(DisplayedLanguage));
        Require(AcceptedPurposeCodes, nameof(AcceptedPurposeCodes));
        Require(DataCategoryCodes, nameof(DataCategoryCodes));
        Require(AppVersion, nameof(AppVersion));
        Require(NoticeHash, nameof(NoticeHash));

        if (UserId == Guid.Empty)
        {
            throw new ArgumentException(
                "userId must be a real account id or null — Guid.Empty is neither, and a row "
                + "carrying it can be attributed to nobody.", nameof(UserId));
        }
    }

    private static void Require(string value, string name)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException(
                $"{name} is required — a consent record without it cannot say what the person was shown.",
                name);
        }
    }
}

/// <summary>Where the acceptance was made. Stored as a short string, not an int, so the
/// row reads correctly without the enum.</summary>
public enum ConsentRecordSource
{
    /// <summary>Installed Android app.</summary>
    App,
    /// <summary>Browser.</summary>
    Web,
}

/// <summary>
/// The state this row asserts. Append-only means a withdrawal is a NEW row with
/// <see cref="Withdrawn"/>, never an edit of the row that granted — which is the only
/// shape in which "when did they withdraw?" has a truthful answer.
/// </summary>
public enum ConsentRecordStatus
{
    Granted,
    Denied,
    Withdrawn,
}
