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
/// <para><b>Whole seconds (MU-3 fix 1, review F1).</b> Every phone sends its cursor back ROUNDED DOWN to the
/// whole second (<c>transport.ts</c>: <c>toISOString().replace(/\.\d{3}Z$/, 'Z')</c>; 1.0.17 has the same
/// line), while an access change is stamped to the microsecond. So "re-sent" is decided at whole-second
/// grain: a change stamped at <c>c</c> is DELIVERED by a response whose cursor is at least
/// <see cref="DeliveredAt"/>(c) = the whole second after <c>c</c>. Rounding a whole second down changes
/// nothing, so a phone that received the re-send sends back a cursor ≥ that second and is never re-sent
/// again; a phone whose cursor is below it (any pull that ran before the change, even in the same second)
/// has not had it, and gets it. A change younger than that second (its whole second is still running at
/// this pull's start) is not re-sent yet — the cursor could not move past it without passing rows not
/// yet written — and the next pull sends it. Exactly once per change, never skipped:</para>
/// <list type="bullet">
/// <item>delivered ⇒ the cursor is ≥ <see cref="DeliveredAt"/>(c) ⇒ the phone's rounded cursor is too ⇒ no re-send;</item>
/// <item>not delivered ⇒ every cursor this person was ever given is ≤ the pull's own start, which is &lt; the
/// change or in the change's own second ⇒ the rounded cursor is &lt; <see cref="DeliveredAt"/>(c) ⇒ re-sent.</item>
/// </list>
///
/// <para><b>The cost.</b> After any access change on a seat, that seat's next pull (at least one second
/// later) re-sends that ONE farm's whole history (every kind it may read) once — what a fresh install
/// downloads. A narrowing re-sends too (harmless; the phone's purge follows the scopes).</para>
///
/// <para><b>Not closed: a change still being SAVED while a pull reads.</b> A pull that reads the seat
/// before the change commits, and also reads a row written in a later second, hands out a cursor past
/// the change's stamp; the change is then never re-sent. Closing it needs every cursor to trail the
/// server clock by a safety margin (re-sending every pull's last seconds to every phone, for every kind)
/// or a lock shared by every access change and every pull; the window is one save of a few milliseconds
/// that must straddle a pull which also reads a newer row, and the owner flipping the switch again
/// closes it. This is the same class as any row stamped before it commits, which the cursor already
/// carries.</para>
/// </summary>
internal sealed class PullReadWindow
{
    private readonly IReadOnlyDictionary<Guid, FarmReadScope> scopes;
    private readonly HashSet<Guid> resetFarms;

    public PullReadWindow(IReadOnlyDictionary<Guid, FarmReadScope> scopes, DateTime sinceUtc, DateTime serverNowUtc)
    {
        this.scopes = scopes;
        SinceUtc = sinceUtc;
        // Re-sent now: not yet delivered to this cursor, and its whole second is over.
        resetFarms = scopes.Values
            .Where(s => s.AccessChangedAtUtc is { } changed
                && sinceUtc < DeliveredAt(changed)
                && DeliveredAt(changed) <= serverNowUtc)
            .Select(s => s.FarmId)
            .ToHashSet();
        ResetThroughUtc = resetFarms.Count == 0
            ? null
            : scopes.Values
                .Where(s => resetFarms.Contains(s.FarmId))
                .Max(s => DeliveredAt(s.AccessChangedAtUtc!.Value));
        // A change too young to send yet: this response's cursor must stay below its second, or a row this
        // pull reads a moment later (stamped in the next second) would carry the cursor past it unsent.
        var pending = scopes.Values
            .Where(s => s.AccessChangedAtUtc is { } changed
                && sinceUtc < DeliveredAt(changed)
                && DeliveredAt(changed) > serverNowUtc)
            .Select(s => DeliveredAt(s.AccessChangedAtUtc!.Value).AddSeconds(-1))
            .ToList();
        PendingCapUtc = pending.Count == 0 ? null : (pending.Min() < sinceUtc ? sinceUtc : pending.Min());
    }

    /// <summary>
    /// The whole second after <paramref name="changedAtUtc"/>: a response whose cursor is at least this has
    /// delivered the change, whatever the phone's rounding does to it.
    /// </summary>
    public static DateTime DeliveredAt(DateTime changedAtUtc)
    {
        var utc = DateTime.SpecifyKind(changedAtUtc, DateTimeKind.Utc);
        return new DateTime(utc.Ticks - (utc.Ticks % TimeSpan.TicksPerSecond), DateTimeKind.Utc).AddSeconds(1);
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

    /// <summary>
    /// The highest cursor this response may hand out while a change is too young to send (its whole second
    /// is still running), or <c>null</c>: the next pull then sends it.
    /// </summary>
    public DateTime? PendingCapUtc { get; }

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
