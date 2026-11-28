namespace ShramSafal.Domain.Logs;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03 build plan, row B5; the founder's final voice-log design,
/// 28 Nov: "If there is any change, you can do it within 24 hours") — "बदल करता येतो · २४ तास".
///
/// <para><b>What it binds.</b> A TALK — a record saved straight from what he told Sathi
/// (<see cref="DailyLog.WasAutoSavedFromVoice"/>; spoken or typed to Sathi) — may be changed by its OWN speaker
/// (<see cref="DailyLog.OperatorUserId"/>) for <see cref="Length"/> after the server first stored it
/// (<see cref="DailyLog.CreatedAtUtc"/>, the server's clock at the create; never a phone's clock, doctrine P10). After
/// that, HIS changes of what he said (a content revision, a move of its place or day, a headcount or hours correction)
/// are refused. Nothing else is: anyone else's change, an owner's confirmation, a product check, an answer to Sathi's
/// question, a reason, naming people on the work (an overlay, P7), a photo — all stay open.</para>
///
/// <para><b>What it does not bind (P11).</b> A record that is not a talk has no window
/// (<see cref="DailyLog.EditableUntilUtc"/> is null): every record a released phone (1.0.17 and older) can make, every
/// typed entry and every हजेरी-door save made without the voice flow. Those keep working exactly as before.</para>
///
/// <para><b>Computed, not stored.</b> The window is a rule over two facts the server already keeps for ever (when it
/// stored the talk, and that it was a talk). If its length is ever changed, stamp each talk's window at its creation
/// FIRST, so a talk keeps the window he was shown when he saved it.</para>
/// </summary>
public static class TalkEditWindow
{
    /// <summary>How long the speaker may change a talk after the server first stored it.</summary>
    public static readonly TimeSpan Length = TimeSpan.FromHours(24);

    /// <summary>
    /// The reason key a phone maps to its own words for the refusal (Marathi first). Carried at the end of the refusal's
    /// message as <c>[reason:editWindowClosed]</c>, the shape <c>[money:…]</c> already uses. Machine-readable and
    /// stable: do not localise it, do not reword it.
    /// </summary>
    public const string ReasonKey = "editWindowClosed";
}
