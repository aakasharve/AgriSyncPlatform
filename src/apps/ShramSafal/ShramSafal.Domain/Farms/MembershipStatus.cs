namespace ShramSafal.Domain.Farms;

/// <summary>
/// Lifecycle of a <see cref="FarmMembership"/>.
///
/// Transitions are explicit methods on <see cref="FarmMembership"/> so the
/// state graph is auditable — see plan spec §8.5.1.
///
/// Terminal states: <see cref="Revoked"/> and <see cref="Exited"/>.
/// No transition out of a terminal state is allowed; a new relationship
/// requires a new membership row.
/// </summary>
public enum MembershipStatus
{
    PendingOtpClaim = 1,
    PendingApproval = 2,
    Active = 3,
    Suspended = 4,
    Revoked = 5,
    Exited = 6,
}
