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
    /// <para>lane F99 fix pass 2 (founder D-71; orchestrator call): <c>notice-2026-11-02.2</c> — the notice,
    /// the Privacy Notice and the Terms now say an erasure request waits 30 days and can be cancelled
    /// until then. A MATERIAL change: everyone who accepted an older notice is asked once, on the phone;
    /// this server still never refuses an older acceptance.</para>
    /// </summary>
    /// <para>lane OPS-1: <c>notice-2026-11-06.1</c> — (a) the English documents name the real in-app page, "Privacy and
    /// consent"; (b) founder D-50: every recording's evidence copy is always kept as proof and the switch is renamed
    /// "Allow playback of my original voice". MATERIAL: everyone who accepted an older notice is asked once, on the
    /// phone. Informational here: the server never refuses on this value.</para>
    public const string NoticeVersion = "notice-2026-11-06.1";

    /// <summary>
    /// The words of the optional improvement switch, "माझ्या अनुभवातून श्रमसफल अधिक सक्षम
    /// होऊ द्या", and its supporting text (founder D-36). An allow counts only against
    /// this version.
    /// </summary>
    public const string ImprovementPermissionVersion = "improve-2026-10-30.1";

    /// <summary>
    /// spec: plr-d10 (I27; founder D-31, D-50 choice 2, CTO call D-101) — the words of the switch, now "Allow playback of my
    /// original voice" / "मूळ आवाज ऐकू देणे" (PROPOSED): "Allow me and authorized reviewers on this farm to play back my
    /// original voice." with the founder's sentence "ShramSafal keeps the original sound of every record as proof; this switch
    /// only decides whether it can be played." The phone sends this string as <c>fullHistoryJournalWordingVersion</c>
    /// (<c>features/consent/improvement/improvementPermissionCopy.ts</c> VOICE_RETENTION_WORDING_VERSION). A new choice is
    /// recorded against these words (P8: the words he saw).
    /// </summary>
    public const string VoiceKeepVersion = "voice-keep-2026-11-06.1";

    /// <summary>
    /// The words the switch had before the D-50 rename: "Keep my original voice recordings so that I and authorized reviewers on
    /// this farm can listen to them." They name EXACTLY the same listeners (him and the people trusted to confirm), so for
    /// playback an ON given under them is still an ON: renaming the switch must not silently stop playback for anyone, and
    /// nobody has to re-confirm. The same pattern as the phone's ACCEPTED_NOTICE_VERSIONS_STILL_CURRENT.
    /// </summary>
    public const string VoiceKeepVersionBeforeRename = "voice-keep-2026-10-30.1";

    /// <summary>True when an ON recorded against <paramref name="wordingVersion"/> allows playback today (current or pre-rename words).</summary>
    public static bool VoiceKeepWordsAllowPlayback(string? wordingVersion) =>
        string.Equals(wordingVersion, VoiceKeepVersion, StringComparison.Ordinal)
        || string.Equals(wordingVersion, VoiceKeepVersionBeforeRename, StringComparison.Ordinal);
}
