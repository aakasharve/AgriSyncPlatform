// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Tasks 2-3)
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Infrastructure.Persistence.InputLibrary;

/// <summary>
/// Loads and saves the input library (<c>ssf.input_library_*</c>) as an <see cref="InputLibraryWorkspace"/>. Every rule lives in
/// the Domain; this is only the mapping to rows. The library is small, so it moves as a whole.
/// </summary>
public static class InputLibraryRows
{
    /// <summary>
    /// The PUBLISHED part of the library: the meta row, published sources and products, the refs of published sources and the
    /// settled differences of published sources. A draft row is never read here, so it cannot reach a farm by any path.
    /// Null when the library has never been seeded in this database.
    ///
    /// <para>This is five statements, not one snapshot, so a publish landing in the middle of the read can hand back a MIX of two
    /// generations (for instance new products with the old source list), not only newer content under an older version. The
    /// meta row (the version) is read FIRST on purpose: whatever mixture arrives carries the older version, so the next poll
    /// sees a newer server version, downloads again and replaces it. A mix therefore heals itself at the next poll. Read the
    /// other way round, a phone could keep older content under a newer version for good, and never heal.</para>
    /// </summary>
    public static async Task<InputLibraryWorkspace?> LoadPublishedAsync(ShramSafalDbContext db, CancellationToken ct)
    {
        var meta = await db.InputLibraryMeta.AsNoTracking().SingleOrDefaultAsync(ct);
        if (meta is null)
        {
            return null;
        }

        var sources = await db.InputLibrarySources.AsNoTracking().Where(s => s.Status == InputLibraryStatus.Published).ToListAsync(ct);
        var products = await db.InputLibraryProducts.AsNoTracking().Where(p => p.Status == InputLibraryStatus.Published).ToListAsync(ct);
        var refs = await db.InputLibrarySourceRefs.AsNoTracking()
            .Where(r => db.InputLibrarySources.Any(s => s.Id == r.SourceId && s.Status == InputLibraryStatus.Published))
            .ToListAsync(ct);
        var conflicts = await db.InputLibraryConflicts.AsNoTracking()
            .Where(c => c.Status == InputLibraryConflictStatus.RealDifference
                        && db.InputLibrarySources.Any(s => s.Id == c.IncomingSourceId && s.Status == InputLibraryStatus.Published))
            .ToListAsync(ct);
        return new InputLibraryWorkspace(meta, sources, products, refs, conflicts);
    }

    /// <summary>The whole library, drafts included, TRACKED so the intake's changes can be saved. Admin use only. Null when never seeded.</summary>
    public static async Task<InputLibraryWorkspace?> LoadAllAsync(ShramSafalDbContext db, CancellationToken ct)
    {
        var meta = await db.InputLibraryMeta.SingleOrDefaultAsync(ct);
        if (meta is null)
        {
            return null;
        }

        return new InputLibraryWorkspace(
            meta,
            await db.InputLibrarySources.ToListAsync(ct),
            await db.InputLibraryProducts.ToListAsync(ct),
            await db.InputLibrarySourceRefs.ToListAsync(ct),
            await db.InputLibraryConflicts.ToListAsync(ct));
    }

    /// <summary>Saves what the intake changed: rows it added, rows it changed (tracked), rows it removed. One transaction.</summary>
    public static async Task SaveAsync(ShramSafalDbContext db, InputLibraryWorkspace workspace, CancellationToken ct)
    {
        foreach (var s in workspace.Sources) AddIfNew(db, s);
        foreach (var p in workspace.Products) AddIfNew(db, p);
        foreach (var r in workspace.SourceRefs) AddIfNew(db, r);
        foreach (var c in workspace.Conflicts) AddIfNew(db, c);

        foreach (var gone in workspace.Removed)
        {
            var entry = db.Entry(gone);
            if (entry.State == EntityState.Detached)
            {
                db.Attach(gone);
            }

            db.Remove(gone);
        }

        await db.SaveChangesAsync(ct);
    }

    private static void AddIfNew(ShramSafalDbContext db, object entity)
    {
        if (db.Entry(entity).State == EntityState.Detached)
        {
            db.Add(entity);
        }
    }
}

/// <summary>The read side of the library for the farm routes (<see cref="IInputLibraryStore"/>): published rows only.</summary>
internal sealed class InputLibraryStore(ShramSafalDbContext db) : IInputLibraryStore
{
    public async Task<string?> GetPublishedVersionAsync(CancellationToken ct = default)
    {
        var meta = await db.InputLibraryMeta.AsNoTracking().SingleOrDefaultAsync(ct);
        return meta?.VersionString;
    }

    public async Task<PublishedLibraryCopy?> GetPublishedAsync(CancellationToken ct = default) =>
        (await InputLibraryRows.LoadPublishedAsync(db, ct))?.BuildPublished();
}

/// <summary>
/// At host start, hands the server's matcher (<see cref="InputCatalog"/>) the published library so it matches against the same
/// library the phones download. Any failure leaves the embedded seed in use; the host never fails to start over the library.
/// </summary>
public static class InputLibraryPublishedCopyLoader
{
    /// <summary>Places the published copy for the matcher. Returns one line saying what happened (for the start-up log).</summary>
    public static async Task<string> TryPlaceAsync(ShramSafalDbContext db, CancellationToken ct)
    {
        try
        {
            var copy = (await InputLibraryRows.LoadPublishedAsync(db, ct))?.BuildPublished();
            if (copy is null)
            {
                return "Input library: no published rows in this database; the embedded seed stays in use.";
            }

            return PublishedInputLibrary.TryPublish(copy.Json, out var reason)
                ? $"Input library: published copy {copy.Version} placed for the matcher."
                : $"Input library: published copy {copy.Version} not used ({reason}); the embedded seed stays in use.";
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return $"Input library: the published copy could not be read ({ex.GetType().Name}); the embedded seed stays in use.";
        }
    }
}
