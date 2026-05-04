// spec: correctionevent-server-persistence
using ShramSafal.Application.UseCases.Corrections;
using ShramSafal.Domain.Corrections;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

internal sealed class CorrectionEventRepository : ICorrectionEventRepository
{
    private readonly ShramSafalDbContext _db;

    public CorrectionEventRepository(ShramSafalDbContext db) => _db = db;

    public async Task AddAsync(CorrectionEvent correction, CancellationToken ct = default)
    {
        await _db.CorrectionEvents.AddAsync(correction, ct);
        await _db.SaveChangesAsync(ct);
    }
}
