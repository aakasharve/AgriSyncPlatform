using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.Persistence;

public sealed class UserDirectoryService(ShramSafalDbContext db) : IUserDirectory
{
    public async Task<IReadOnlyDictionary<Guid, string>> GetDisplayNamesAsync(
        IEnumerable<Guid> userIds,
        CancellationToken ct = default)
    {
        var ids = userIds.Distinct().ToList();
        if (ids.Count == 0)
            return new Dictionary<Guid, string>();

        // Read from public.users table — same DB, different schema, no project reference needed.
        // spec: plr-d10 lane MU-2 — the key column is "Id" (Phase2UserInitial creates it quoted); an unquoted id names a
        // column that does not exist (42703).
        var rows = await db.Database
            .SqlQueryRaw<UserDisplayNameRow>(
                "SELECT \"Id\" AS \"Id\", display_name AS \"DisplayName\" FROM public.users WHERE \"Id\" = ANY(@ids)",
                new Npgsql.NpgsqlParameter("ids", ids.ToArray()))
            .ToListAsync(ct);

        return rows.ToDictionary(r => r.Id, r => r.DisplayName);
    }

    /// <inheritdoc />
    public async Task<string?> GetVerifiedPhoneAsync(Guid userId, CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
            return null;

        // spec: plr-d10 lane MU-2 — public.users is the global directory (no RLS on it, by design); the number counts
        // only when a one-time code proved it.
        var rows = await db.Database
            .SqlQueryRaw<UserPhoneRow>(
                "SELECT phone AS \"Phone\" FROM public.users WHERE \"Id\" = @id AND phone_verified_at_utc IS NOT NULL",
                new Npgsql.NpgsqlParameter("id", userId))
            .ToListAsync(ct);

        return rows.Count == 1 ? rows[0].Phone : null;
    }

    private sealed record UserDisplayNameRow(Guid Id, string DisplayName);

    private sealed record UserPhoneRow(string Phone);
}
