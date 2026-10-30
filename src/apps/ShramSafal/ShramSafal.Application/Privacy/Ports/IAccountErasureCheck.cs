// spec: plr-d10-redesign-real-integration-2026-10-25 (I27)
namespace ShramSafal.Application.Privacy.Ports;

/// <summary>
/// "Has this person asked for his account to be erased?" — asked about SOMEONE ELSE from inside
/// another person's request (the reviewer's replay of the speaker's voice).
///
/// <para><b>Not a second rule.</b> The answer is
/// <see cref="IImprovementPermissionStore.IsAccountErasureRequestedAsync"/>, the exact check
/// <c>ImprovementPermissionGate</c> makes. That store reads the erasure ledger AS the person
/// (its row-level security is self-only), which a request already running as the reviewer cannot
/// do in place: a user-scoped request may not change identity. So this port runs the same store
/// call in its OWN scope and connection, leaving the caller's request untouched.</para>
/// </summary>
public interface IAccountErasureCheck
{
    /// <summary>True when an erasure was asked for this account (any status).</summary>
    Task<bool> IsErasureRequestedAsync(Guid userId, CancellationToken ct = default);
}
