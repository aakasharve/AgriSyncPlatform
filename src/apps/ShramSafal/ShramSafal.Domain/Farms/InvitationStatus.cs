namespace ShramSafal.Domain.Farms;

/// <summary>
/// Simplified invitation lifecycle — the owner-requested complexity cut
/// (no TTL, no max-uses, no approval gate) means there are only two
/// meaningful states.
/// </summary>
public enum InvitationStatus
{
    Active = 1,
    Revoked = 2,
}
