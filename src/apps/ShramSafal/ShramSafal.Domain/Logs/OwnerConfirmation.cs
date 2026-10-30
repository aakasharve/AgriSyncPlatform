using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Logs;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — founder D-44 / D-46 / D-31.
/// How a confirmer says he reviewed a record. Machine-readable and stable: do not localise
/// or reword; <c>ck_verification_events_review_basis</c> compares against these exact strings.
/// </summary>
public static class ReviewBasis
{
    /// <summary>He played the original voice before confirming.</summary>
    public const string Heard = "heard";

    /// <summary>He confirmed from the text without listening (D-44: "noted as read-not-heard").</summary>
    public const string Read = "read";

    /// <summary>
    /// <c>true</c> for null / blank (= not stated, every older phone) and for the two known
    /// values; <paramref name="normalized"/> is then null or the canonical value. <c>false</c>
    /// for anything else — a value we do not know is refused, never guessed.
    /// </summary>
    public static bool TryNormalize(string? raw, out string? normalized)
    {
        normalized = null;
        if (string.IsNullOrWhiteSpace(raw))
        {
            return true;
        }

        var value = raw.Trim();
        if (string.Equals(value, Heard, StringComparison.Ordinal))
        {
            normalized = Heard;
            return true;
        }

        if (string.Equals(value, Read, StringComparison.Ordinal))
        {
            normalized = Read;
            return true;
        }

        return false;
    }
}

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — WHO may give a record the
/// owner's confirmation ("मालकाकडून खात्री", reached as <see cref="VerificationStatus.Verified"/>).
///
/// <para><b>The rule (founder D-44 §2-3, D-46 §3):</b></para>
/// <code>
/// PrimaryOwner                         -> may confirm any record, his own included ("save and confirm")
/// a member holding the owner's grant   -> may confirm (founder 2026-08-27: "granted mukadam can
///                                         approve his own log" — the bar is the grant, not authorship)
/// everyone else (co-owner, मुकादम,     -> may not confirm; "being appointed मुकादम or co-owner
///   agronomist, worker) by role alone     must not automatically grant this authority"
/// </code>
///
/// <para><b>The grant</b> is the EXISTING owner switch (जबाबदारी, stored as
/// <c>can_manage_labour_records</c>, clock-evaluated by <c>LabourManagementGate</c>). It is
/// passed in, never looked up: the Domain has no database (doctrine E2).</para>
///
/// <para><b>"The speaker is never asked to confirm his own record"</b> (D-44) is a rule about
/// ASKING, kept where asking happens: the result screen offers "save and confirm" to the primary
/// owner alone, and the I13 result-screen tap (which stated no review basis) is kept as the
/// speaker's mark (<see cref="DailyLog.SpeakerOwnMarkReason"/>), never as the owner's
/// confirmation — <c>VerifyLogHandler</c> applies that.</para>
///
/// <para>Pure on purpose, so the Domain suite can enumerate every role against both grant
/// states without a database.</para>
/// </summary>
public static class OwnerConfirmationAuthority
{
    public static bool MayConfirm(AppRole role, bool hasExplicitGrant) =>
        role == AppRole.PrimaryOwner || hasExplicitGrant;

    /// <summary>
    /// spec: plr-d10 (I27; founder D-44 §2, D-46 §3) — whose OWN save the server may record as
    /// already confirmed ("save and confirm"): the primary owner's, and nobody else's.
    ///
    /// <para>Narrower than <see cref="MayConfirm"/> on purpose. A grant holder may still confirm
    /// his own record, but only by the deliberate act in the review sheet (founder 2026-08-27,
    /// <c>VerifyLogHandler</c>) — never silently at save. A co-owner, agronomist or FPC manager
    /// holds the FSM edges by role, but role alone is not the owner's confirmation, so their
    /// saves stay pending ("पक्कं नाही") like everyone else's, old phones included.</para>
    /// </summary>
    public static bool MaySelfAttestAtSave(AppRole role) => role == AppRole.PrimaryOwner;

    /// <summary>
    /// spec: plr-d10 (I27, review N4) — whether a transition the FSM allows this caller may be
    /// OFFERED to him. The owner's decision (→<see cref="VerificationStatus.Verified"/>,
    /// →<see cref="VerificationStatus.Disputed"/>) is offered only to someone
    /// <c>VerifyLogHandler</c> counts it from; anyone else's tap is kept as a mark, so offering
    /// it would be a control that does nothing (P5). Every other edge is unchanged.
    /// </summary>
    public static bool MayBeOffered(VerificationStatus to, AppRole role, bool hasExplicitGrant) =>
        (to != VerificationStatus.Verified && to != VerificationStatus.Disputed)
        || MayConfirm(role, hasExplicitGrant);
}
