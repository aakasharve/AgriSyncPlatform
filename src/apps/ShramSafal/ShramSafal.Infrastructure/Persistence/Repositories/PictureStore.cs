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
}
