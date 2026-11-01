using ShramSafal.Application.Services;

namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

/// <summary>
/// lane MU-3 (plan §2 #6, §6 #12) — which farms one pull reads, with what each person may read there
/// (<see cref="FarmReadScope"/>), and from WHEN.
///
/// <para><b>The per-farm cursor reset.</b> A phone holds ONE cursor across all its farms. A seat whose
/// reading WIDENED after that cursor (see money switched on, an approval, a label change — anything that
/// stamped <see cref="FarmReadScope.AccessChangedAtUtc"/>) would otherwise never receive the older rows it
/// was not allowed to see when they last changed. Such a farm is read from the beginning instead; every
/// other farm from the cursor, exactly as before. Each kind is read at most twice (once per group), and
/// every row is re-checked against its OWN group's farms (E4), so a repository that ignores the farm
/// list (a test double's default body) still cannot send a row twice or another farm's row.</para>
///
/// <para><b>The cost.</b> After any access change on a seat, that seat's next pull re-sends that ONE
/// farm's whole history (every kind it may read) once; then the cursor moves past the change
/// (<see cref="ResetThroughUtc"/>) so it is not re-sent again. A narrowing re-sends too (harmless; the
/// phone's purge follows the scopes, not the re-send).</para>
/// </summary>
internal sealed class PullReadWindow
{
    private readonly IReadOnlyDictionary<Guid, FarmReadScope> scopes;
    private readonly HashSet<Guid> resetFarms;

    public PullReadWindow(IReadOnlyDictionary<Guid, FarmReadScope> scopes, DateTime sinceUtc, DateTime serverNowUtc)
    {
        this.scopes = scopes;
        SinceUtc = sinceUtc;
        resetFarms = scopes.Values
            .Where(s => s.AccessChangedAtUtc is { } changed && changed > sinceUtc)
            .Select(s => s.FarmId)
            .ToHashSet();
        var latest = scopes.Values
            .Where(s => resetFarms.Contains(s.FarmId))
            .Select(s => s.AccessChangedAtUtc!.Value)
            .DefaultIfEmpty(DateTime.MinValue)
            .Max();
        ResetThroughUtc = resetFarms.Count == 0 ? null : (latest > serverNowUtc ? serverNowUtc : latest);
    }

    /// <summary>The phone's cursor.</summary>
    public DateTime SinceUtc { get; }

    /// <summary>Every farm this pull reads, in a stable order.</summary>
    public IReadOnlyList<Guid> FarmIds => scopes.Keys.OrderBy(id => id).ToList();

    /// <summary>The scopes, by farm.</summary>
    public IReadOnlyDictionary<Guid, FarmReadScope> Scopes => scopes;

    /// <summary>
    /// The newest access change this pull re-sent a farm for (capped at the server's clock), or
    /// <c>null</c> when nothing was re-sent: the next cursor is at least this, so the farm is re-sent once.
    /// </summary>
    public DateTime? ResetThroughUtc { get; }

    /// <summary>The farms re-sent from the beginning by this pull.</summary>
    public IReadOnlyCollection<Guid> ResetFarmIds => resetFarms;

    /// <summary>The scope of one farm, or null when this pull reads nothing of it.</summary>
    public FarmReadScope? ScopeOf(Guid farmId) => scopes.GetValueOrDefault(farmId);

    /// <summary>The cursor to read <paramref name="farmId"/> from.</summary>
    public DateTime SinceFor(Guid farmId) => resetFarms.Contains(farmId) ? DateTime.UnixEpoch : SinceUtc;

    /// <summary>
    /// The (farms, since) groups a kind is read in: the farms whose scope admits the kind, split into
    /// those read from the cursor and those re-sent from the beginning. Empty groups are left out.
    /// </summary>
    public IEnumerable<(IReadOnlyList<Guid> Farms, DateTime SinceUtc)> Groups(Func<FarmReadScope, bool> admits)
    {
        var admitted = scopes.Values.Where(admits).Select(s => s.FarmId).OrderBy(id => id).ToList();
        var fromCursor = admitted.Where(id => !resetFarms.Contains(id)).ToList();
        var fromStart = admitted.Where(resetFarms.Contains).ToList();
        if (fromCursor.Count > 0)
        {
            yield return (fromCursor, SinceUtc);
        }

        if (fromStart.Count > 0)
        {
            yield return (fromStart, DateTime.UnixEpoch);
        }
    }

    /// <summary>
    /// Reads one kind in its groups and keeps a row only when its farm is in the group it was read for
    /// (E4: a row is never trusted for its query alone).
    /// </summary>
    public async Task<List<T>> ReadAsync<T>(
        Func<FarmReadScope, bool> admits,
        Func<IReadOnlyList<Guid>, DateTime, Task<List<T>>> read,
        Func<T, Guid> farmOf)
    {
        var rows = new List<T>();
        foreach (var (farms, since) in Groups(admits))
        {
            var allowed = farms.ToHashSet();
            rows.AddRange((await read(farms, since)).Where(row => allowed.Contains(farmOf(row))));
        }

        return rows;
    }
}
