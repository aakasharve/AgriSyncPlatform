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

    /// <summary>
    /// lane MU-2 fix round 1 (review H-1) — the proven numbers of several people at once, keyed by user id; a person with no
    /// proven number has no entry. Compared on the server only (never sent): did the claim come from the number the owner
    /// named? The default asks one by one.
    /// </summary>
    async Task<IReadOnlyDictionary<Guid, string>> GetVerifiedPhonesAsync(IEnumerable<Guid> userIds, CancellationToken ct = default)
    {
        var phones = new Dictionary<Guid, string>();
        foreach (var id in userIds.Where(id => id != Guid.Empty).Distinct())
        {
            if (await GetVerifiedPhoneAsync(id, ct) is { Length: > 0 } phone)
            {
                phones[id] = phone;
            }
        }

        return phones;
    }
}
