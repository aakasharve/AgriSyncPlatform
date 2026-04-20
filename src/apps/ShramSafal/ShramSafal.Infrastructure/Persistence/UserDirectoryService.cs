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
        var rows = await db.Database
            .SqlQueryRaw<UserDisplayNameRow>(
                "SELECT id AS \"Id\", display_name AS \"DisplayName\" FROM public.users WHERE id = ANY(@ids)",
                new Npgsql.NpgsqlParameter("ids", ids.ToArray()))
            .ToListAsync(ct);

        return rows.ToDictionary(r => r.Id, r => r.DisplayName);
    }

    private sealed record UserDisplayNameRow(Guid Id, string DisplayName);
}
