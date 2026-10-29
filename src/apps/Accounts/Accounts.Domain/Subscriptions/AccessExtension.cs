using AgriSync.SharedKernel.Contracts.Ids;

namespace Accounts.Domain.Subscriptions;

/// <summary>
/// spec R-11 (b) (pre-launch repair, founder N-1, 26 Oct: "Until the continuation path is
/// operational, do not enforce a hard stop on real pilot farms. Use an explicit, server-managed
/// pilot extension with a recorded reason and end date").
///
/// <para>A recorded decision that an owner account keeps paid access from
/// <see cref="StartsAtUtc"/> until <see cref="EndsAtUtc"/> whatever its subscription status says.
/// It is NOT a subscription: it never changes a subscription row, never starts or restarts a trial,
/// invents no price or plan, and says nothing about payment or farm verification. The entitlement
/// policy honours it (<c>DefaultEntitlementPolicy</c>) and nothing else reads it as a plan.</para>
///
/// <para>Append-only by design: an extension is granted by a named person for a written reason
/// and is never edited. A different end date is a new row (the latest active row wins in effect,
/// every row stays as history).</para>
/// </summary>
public sealed class AccessExtension
{
    public const int MaxReasonLength = 200;

    private AccessExtension() { } // EF Core

    private AccessExtension(
        Guid id,
        OwnerAccountId ownerAccountId,
        string reason,
        DateTime startsAtUtc,
        DateTime endsAtUtc,
        Guid grantedByUserId,
        DateTime createdAtUtc)
    {
        Id = id;
        OwnerAccountId = ownerAccountId;
        Reason = reason;
        StartsAtUtc = startsAtUtc;
        EndsAtUtc = endsAtUtc;
        GrantedByUserId = grantedByUserId;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid Id { get; private set; }
    public OwnerAccountId OwnerAccountId { get; private set; }
    public string Reason { get; private set; } = string.Empty;
    public DateTime StartsAtUtc { get; private set; }
    public DateTime EndsAtUtc { get; private set; }

    /// <summary>The admin who granted it, or the all-ones system actor for a migration data step.</summary>
    public Guid GrantedByUserId { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>Start inclusive, end exclusive.</summary>
    public bool IsActiveAt(DateTime utc) => StartsAtUtc <= utc && utc < EndsAtUtc;

    public static AccessExtension Grant(
        Guid id,
        OwnerAccountId ownerAccountId,
        string reason,
        DateTime startsAtUtc,
        DateTime endsAtUtc,
        Guid grantedByUserId,
        DateTime createdAtUtc)
    {
        if (id == Guid.Empty) throw new ArgumentException("Extension id is required.", nameof(id));
        if (ownerAccountId.IsEmpty) throw new ArgumentException("OwnerAccount id is required.", nameof(ownerAccountId));
        if (grantedByUserId == Guid.Empty) throw new ArgumentException("Who granted the extension is required.", nameof(grantedByUserId));

        var trimmed = reason?.Trim() ?? string.Empty;
        if (trimmed.Length == 0) throw new ArgumentException("A reason is required.", nameof(reason));
        if (trimmed.Length > MaxReasonLength) throw new ArgumentException($"Reason is longer than {MaxReasonLength} characters.", nameof(reason));
        if (endsAtUtc <= startsAtUtc) throw new ArgumentException("An extension must end after it starts.", nameof(endsAtUtc));

        return new AccessExtension(
            id,
            ownerAccountId,
            trimmed,
            DateTime.SpecifyKind(startsAtUtc, DateTimeKind.Utc),
            DateTime.SpecifyKind(endsAtUtc, DateTimeKind.Utc),
            grantedByUserId,
            createdAtUtc);
    }
}
