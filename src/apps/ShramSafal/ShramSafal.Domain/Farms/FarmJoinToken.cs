using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// The signed secret that sits inside the QR payload.
///
/// Stored as both a raw value (for owner re-display) and a SHA-256 hash
/// (for the claim-path O(1) lookup). The hash is the authoritative
/// identifier; the raw value is a convenience so the owner's
/// "Share farm QR" sheet survives device changes without invalidating
/// already-shared QRs.
///
/// Tradeoff accepted: a DB-read-only attacker can forge claims. The
/// single lever against that is rotation — owners revoke + re-issue
/// whenever a token is suspected compromised. Encryption-at-rest for
/// <see cref="RawToken"/> is tracked as Phase 8 hardening.
///
/// There is exactly one Active token per farm at a time. Rotate replaces
/// both the invitation and its token atomically.
/// </summary>
public sealed class FarmJoinToken : Entity<FarmJoinTokenId>
{
    private FarmJoinToken() : base(default) { } // EF Core

    private FarmJoinToken(
        FarmJoinTokenId id,
        FarmInvitationId invitationId,
        FarmId farmId,
        string rawToken,
        string tokenHash,
        DateTime createdAtUtc)
        : base(id)
    {
        InvitationId = invitationId;
        FarmId = farmId;
        RawToken = rawToken;
        TokenHash = tokenHash;
        CreatedAtUtc = createdAtUtc;
    }

    public FarmInvitationId InvitationId { get; private set; }
    public FarmId FarmId { get; private set; }
    public string RawToken { get; private set; } = string.Empty;
    public string TokenHash { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }
    public bool IsRevoked { get; private set; }
    public DateTime? RevokedAtUtc { get; private set; }

    public static FarmJoinToken Issue(
        FarmJoinTokenId id,
        FarmInvitationId invitationId,
        FarmId farmId,
        string rawToken,
        string tokenHash,
        DateTime createdAtUtc)
    {
        if (id.IsEmpty) throw new ArgumentException("Token id is required.", nameof(id));
        if (invitationId.IsEmpty) throw new ArgumentException("Invitation id is required.", nameof(invitationId));
        if (farmId.IsEmpty) throw new ArgumentException("Farm id is required.", nameof(farmId));
        if (string.IsNullOrWhiteSpace(rawToken)) throw new ArgumentException("Raw token is required.", nameof(rawToken));
        if (string.IsNullOrWhiteSpace(tokenHash)) throw new ArgumentException("Token hash is required.", nameof(tokenHash));

        return new FarmJoinToken(id, invitationId, farmId, rawToken, tokenHash, createdAtUtc);
    }

    public void Revoke(DateTime utcNow)
    {
        if (IsRevoked) return;
        IsRevoked = true;
        RevokedAtUtc = utcNow;
    }
}
