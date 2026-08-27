namespace ShramSafal.Application.UseCases.Consent.LinkConsentGateToUser;

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves (B1) — the account behind a pre-login acceptance.
///
/// <para>Counterpart to <c>RecordConsentGateAcceptanceCommand</c>. That one is written by
/// an anonymous caller and lands with <c>user_id NULL</c>, because the gate renders only
/// when <c>!isAuthenticated</c>. This one is written once the account exists and names it.
/// Founder ruling 2026-08-27, option (a): a NEW row, never an edit of the original.</para>
///
/// <para><b>Why the facts are re-supplied rather than a row id.</b> The orphaned row
/// cannot be read back by ANY role — both ledgers are FORCE ROW LEVEL SECURITY and the
/// policy's USING clause requires <c>user_id IS NOT NULL</c>, while <c>agrisync_admin</c>
/// holds neither <c>rolsuper</c> nor <c>rolbypassrls</c>. A command carrying "link row
/// 4f2c…" would name something nothing in this system can dereference, and the handler
/// could not validate it, echo it, or prove it existed. So the client re-states what it
/// showed, and the linking row stands on its own as evidence.</para>
///
/// <para><b>What this command does NOT carry, on purpose.</b> No age declaration and no
/// acceptance timestamp. The farmer is not agreeing to anything here — he already did, at
/// the gate, and that moment is stamped on the original row. Asking for the declaration
/// again would imply a second act of consent that never happened, and accepting a
/// client-supplied acceptance time would let a legal record be back-dated from a device.
/// The link is stamped with the server's clock at link time.</para>
/// </summary>
/// <param name="UserId">
/// The account, taken from the validated JWT subject by the endpoint — never from the
/// request body. Required and non-empty: a linking command with no user is the defect
/// itself, wearing a fix's clothes.
/// </param>
/// <param name="PreRegistrationSessionId">
/// The id the client minted on first open and kept. It is the only join key that exists
/// across the pre-login window, and it is what says WHICH acceptance this account owns.
/// </param>
/// <param name="DisplayedNoticeText">
/// The exact notice the gate rendered, in the language it rendered it in. Hashed
/// server-side and discarded, exactly as the accepting command does — a hash the client
/// both computes and asserts proves only that the client agrees with itself. Matching
/// hashes on the accepting row and the linking row are what let a future reader see the
/// two rows are about the same words.
/// </param>
public sealed record LinkConsentGateToUserCommand(
    Guid UserId,
    string PreRegistrationSessionId,
    string NoticeVersion,
    string PrivacyPolicyVersion,
    string TermsVersion,
    string DisplayedLanguage,
    IReadOnlyList<string> AcceptedPurposeCodes,
    IReadOnlyList<string> DataCategoryCodes,
    string Source,
    string AppVersion,
    string DisplayedNoticeText);

/// <summary>
/// The two linking rows, so the caller can prove both landed and stop retrying.
/// </summary>
/// <param name="TermsAcceptanceEventId">The <c>TERMS_ACCEPTANCE_LINKED</c> row.</param>
/// <param name="ConsentGrantEventId">The <c>CORE_DPDP_CONSENT_LINKED</c> row.</param>
/// <param name="AlreadyLinked">
/// True when both rows were already present and this call wrote nothing. The client's
/// success path is identical either way — that is what makes the call safe to retry on
/// every app start until it succeeds, which is the whole reason a failure here can never
/// need to block a farmer.
/// </param>
public sealed record ConsentGateLinkResult(
    Guid TermsAcceptanceEventId,
    Guid ConsentGrantEventId,
    bool AlreadyLinked);
