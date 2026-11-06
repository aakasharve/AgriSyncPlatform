namespace ShramSafal.Application.Ports.External;

/// <summary>
/// Read-only cross-module port for resolving user display names.
/// Backed by a raw SQL query against public.users — no User.Infrastructure project reference.
/// </summary>
public interface IUserDirectory
{
    Task<IReadOnlyDictionary<Guid, string>> GetDisplayNamesAsync(
        IEnumerable<Guid> userIds,
        CancellationToken ct = default);

    /// <summary>
    /// spec: plr-d10 lane MU-2 — the person's mobile number, ONLY when he proved it with a one-time code
    /// (<c>public.users.phone_verified_at_utc</c> is set; a password sign-up never sets it, D-23). The server's own
    /// record, never a value from the request or the token. <c>null</c> = no proven number. The default answers
    /// <c>null</c>, which fails closed: every claim then waits for the owner.
    /// </summary>
    Task<string?> GetVerifiedPhoneAsync(Guid userId, CancellationToken ct = default) => Task.FromResult<string?>(null);
}
