namespace User.Domain.Security;

/// <summary>
/// spec: plr-d10 lane NP-1 (founder D-56, CTO call D-85) — where a session stands on the one-time
/// "हे खातं ‹नाव› यांचं आहे — तुम्ही तेच आहात का?" question. A session that is not held has no state at
/// all (<c>null</c>): its phone is known for the account (it said होय, it made the account, or it was
/// signed in before this question existed).
/// </summary>
public enum DeviceCheckState
{
    /// <summary>Held: signed in with the SMS code on a phone the account has never confirmed.</summary>
    AskedAfterSmsCode = 1,

    /// <summary>Held: signed in with the (test-only) password on such a phone.</summary>
    AskedAfterPassword = 2,

    /// <summary>
    /// The person answered "नाही": the session ended at once. Kept as ShramSafal support's
    /// "number may have changed hands" mark; nothing in the account changes.
    /// </summary>
    Declined = 3,
}
