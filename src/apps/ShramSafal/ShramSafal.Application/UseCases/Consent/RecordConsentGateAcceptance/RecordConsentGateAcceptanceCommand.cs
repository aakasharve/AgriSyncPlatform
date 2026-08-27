namespace ShramSafal.Application.UseCases.Consent.RecordConsentGateAcceptance;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-4.2) — one tap on the first-open gate.
///
/// <para>The command carries the notice TEXT, not its hash. The hash is what gets
/// stored, and a hash the client both computes and asserts proves only that the client
/// agrees with itself. The server hashes what it was told was displayed, so the stored
/// digest is the server's own statement about the words.</para>
/// </summary>
/// <param name="UserId">
/// NULL in the ordinary case — the gate runs before login. Present only when an already
/// signed-in caller re-accepts a new notice version.
/// </param>
/// <param name="PreRegistrationSessionId">Client-minted, stable, always present.</param>
/// <param name="DisplayedNoticeText">
/// The exact notice as rendered, in the language it was rendered in. Hashed, then
/// discarded — the text itself is client-side copy under version control, so storing it
/// per row would duplicate the repo into the database for no evidentiary gain.
/// </param>
public sealed record RecordConsentGateAcceptanceCommand(
    Guid? UserId,
    string PreRegistrationSessionId,
    string NoticeVersion,
    string PrivacyPolicyVersion,
    string TermsVersion,
    string DisplayedLanguage,
    IReadOnlyList<string> AcceptedPurposeCodes,
    IReadOnlyList<string> DataCategoryCodes,
    string Source,
    string AppVersion,
    string DisplayedNoticeText,
    bool AgeDeclaredAdult);

/// <summary>The two ids written, so the caller can prove both landed.</summary>
public sealed record ConsentGateAcceptanceResult(Guid TermsAcceptanceEventId, Guid ConsentGrantEventId);
