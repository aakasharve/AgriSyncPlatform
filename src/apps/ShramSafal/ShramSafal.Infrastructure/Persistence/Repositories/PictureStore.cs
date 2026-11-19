using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Pictures;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: plr-d10 lane SCH-ID-S (founder D-146) - EF Core implementation of <see cref="IPictureStore"/>. Shares the scoped
/// <see cref="ShramSafalDbContext"/>, so a staged row is committed by the caller's one save with its audit row.
/// </summary>
internal sealed class PictureStore(ShramSafalDbContext context) : IPictureStore
{
    public Task<Picture?> GetAsync(PictureKind kind, Guid subjectId, CancellationToken ct = default) =>
        context.Pictures.FirstOrDefaultAsync(p => p.Kind == kind && p.SubjectId == subjectId, ct);

    public Task<Picture?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
        context.Pictures.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);

    public async Task<IReadOnlyList<Picture>> GetManyAsync(
        PictureKind kind, IReadOnlyCollection<Guid> subjectIds, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(subjectIds);
        if (subjectIds.Count == 0)
        {
            return [];
        }

        var ids = subjectIds.ToList();
        return await context.Pictures
            .AsNoTracking()
            .Where(p => p.Kind == kind && ids.Contains(p.SubjectId))
            .ToListAsync(ct);
    }

    public void Stage(Picture picture)
    {
        ArgumentNullException.ThrowIfNull(picture);
        context.Pictures.Add(picture);
    }

    public void Remove(Picture picture)
    {
        ArgumentNullException.ThrowIfNull(picture);
        context.Pictures.Remove(picture);
    }

    /// <summary>The one-row-per-(kind, subject) unique index (declared in <c>PictureConfiguration</c>): the only violation caught here.</summary>
    internal const string KindSubjectIndex = "ux_pictures_kind_subject";

    public async Task<bool> TrySaveNewAsync(CancellationToken ct = default)
    {
        // Inside the request the save runs in the request's transaction, and Postgres aborts a whole transaction on a unique violation: a
        // SAVEPOINT lets the caller go on (re-read the winner) in the same transaction, the way TrySaveScheduleSubscriptionAsync does.
        // Without an ambient transaction the save is its own and a refusal leaves nothing behind either.
        var transaction = context.Database.IsRelational() ? context.Database.CurrentTransaction : null;
        const string savepoint = "ssf_picture_first_save";
        if (transaction is not null)
        {
            await transaction.CreateSavepointAsync(savepoint, ct);
        }

        try
        {
            await context.SaveChangesAsync(ct);
            if (transaction is not null)
            {
                await transaction.ReleaseSavepointAsync(savepoint, ct);
            }

            return true;
        }
        catch (DbUpdateException ex) when (ShramSafalRepository.IsUniqueViolationOn(ex, KindSubjectIndex))
        {
            // Lost the first-upload race. Undo the doomed statements, then discard everything this unit staged (the picture and its
            // audit row) so a later SaveChanges cannot replay the doomed INSERTs; the handler re-reads the winner and answers from it.
            if (transaction is not null)
            {
                await transaction.RollbackToSavepointAsync(savepoint, ct);
            }

            foreach (var entry in context.ChangeTracker.Entries()
                         .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
                         .ToList())
            {
                entry.State = EntityState.Detached;
            }

            return false;
        }
    }
}
