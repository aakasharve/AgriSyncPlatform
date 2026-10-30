namespace ShramSafal.Domain.Consent;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-13, D-36) — the
/// wording versions the server treats as CURRENT. One string names exactly one text.
///
/// <para><b>These are never a reason to refuse a request.</b> An old phone that sends an
/// older version is recorded exactly as it sent it (doctrine P11). A version only decides
/// what a stored choice is WORTH: an "allow" given against older words does not count for
/// the words in force now (see <c>ImprovementPermissionGate</c>).</para>
///
/// <para><b>Kept in step with the phone by hand.</b> The phone bundles the same strings
/// (<c>features/consent/gate/consentNotice.ts</c> NOTICE_VERSION and
/// <c>features/consent/improvement/improvementPermissionCopy.ts</c>). Drift fails CLOSED in
/// both directions: an allow recorded against a version the server does not call current
/// is not counted.</para>
/// </summary>
public static class CurrentConsentWording
{
    /// <summary>
    /// The consent notice the phone shows with the required tick (founder D-36: the
    /// absolute voice promise was replaced, so the change is material and everyone is asked
    /// once). Exposed on <c>GET /consent/me</c> so a phone and a report can tell who has
    /// accepted the notice in force.
    /// </summary>
    public const string NoticeVersion = "notice-2026-10-30.1";

    /// <summary>
    /// The words of the optional improvement switch, "माझ्या अनुभवातून श्रमसफल अधिक सक्षम
    /// होऊ द्या", and its supporting text (founder D-36). An allow counts only against
    /// this version.
    /// </summary>
    public const string ImprovementPermissionVersion = "improve-2026-10-30.1";

    /// <summary>
    /// spec: plr-d10 (I27; founder D-31) — the words of the "मूळ आवाज जतन करा" switch that
    /// disclose listening by authorised reviewers on the farm ("Keep my original voice
    /// recordings so that I and authorized reviewers on this farm can listen to them"). The
    /// phone sends this string as <c>fullHistoryJournalWordingVersion</c>
    /// (<c>features/consent/improvement/improvementPermissionCopy.ts</c>
    /// VOICE_RETENTION_WORDING_VERSION). A reviewer may replay a recording only while the
    /// speaker's switch is ON under exactly these words.
    /// </summary>
    public const string VoiceKeepVersion = "voice-keep-2026-10-30.1";
}
