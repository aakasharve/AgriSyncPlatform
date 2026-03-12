using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

internal sealed class DocumentExtractionSessionRepository(ShramSafalDbContext dbContext)
    : IDocumentExtractionSessionRepository
{
    public async Task SaveAsync(DocumentExtractionSession session, CancellationToken ct = default)
    {
        var existing = await dbContext.DocumentExtractionSessions
            .FirstOrDefaultAsync(x => x.Id == session.Id, ct);

        if (existing is null)
        {
            dbContext.DocumentExtractionSessions.Add(session);
        }
        else if (!ReferenceEquals(existing, session))
        {
            dbContext.Entry(existing).CurrentValues.SetValues(session);
        }

        await dbContext.SaveChangesAsync(ct);
    }

    public async Task<DocumentExtractionSession?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        return await dbContext.DocumentExtractionSessions
            .FirstOrDefaultAsync(x => x.Id == id, ct);
    }

    public async Task<List<DocumentExtractionSession>> GetPendingVerificationAsync(
        int limit,
        decimal maxDraftConfidence,
        CancellationToken ct = default)
    {
        return await dbContext.DocumentExtractionSessions
            .Where(x => x.Status == ExtractionSessionStatus.DraftReady &&
                        x.DraftConfidence < maxDraftConfidence &&
                        x.InputImagePath != null)
            .OrderBy(x => x.CreatedAtUtc)
            .Take(limit)
            .ToListAsync(ct);
    }
}
