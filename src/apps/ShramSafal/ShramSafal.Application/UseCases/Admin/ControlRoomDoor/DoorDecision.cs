// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A6)
using ShramSafal.Domain.ControlRoom;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomDoor;

/// <summary>What the console door decided about a typed number.</summary>
public enum DoorOutcome
{
    /// <summary>Not an Indian mobile number. The same for everyone, so it may be said (400 on send).</summary>
    InvalidPhone,

    /// <summary>An active person with this number (whose bound account, if any, still holds it), or the founder's number.</summary>
    Approved,

    /// <summary>Every other number. Never told apart from <see cref="Approved"/> in what the caller sees.</summary>
    NotApproved,
}

/// <summary>
/// The door's decision. <see cref="PhoneE164"/> and <see cref="TenDigits"/> are the normalised number (null only for
/// <see cref="DoorOutcome.InvalidPhone"/>); the typed text is never used past the decision. <see cref="Person"/> is the
/// matched person row (null for the founder and for a number nobody holds). <see cref="RefusalReason"/> is set only for
/// <see cref="DoorOutcome.NotApproved"/>: <c>not_listed</c>, or <c>account_changed</c> (H3).
/// </summary>
public sealed record DoorDecision(
    DoorOutcome Outcome,
    string? PhoneE164,
    string? TenDigits,
    ControlRoomPerson? Person,
    bool IsFounder,
    string? RefusalReason);
