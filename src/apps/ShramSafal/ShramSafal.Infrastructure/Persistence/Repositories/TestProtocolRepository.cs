using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// CEI Phase 3 §4.5 — EF Core implementation of <see cref="ITestProtocolRepository"/>.
/// </summary>
internal sealed class TestProtocolRepository(ShramSafalDbContext context) : ITestProtocolRepository
{
    public async Task AddAsync(TestProtocol protocol, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(protocol);
        await context.TestProtocols.AddAsync(protocol, ct);
        await context.SaveChangesAsync(ct);
    }

    public async Task<TestProtocol?> GetByIdAsync(Guid protocolId, CancellationToken ct = default)
    {
        if (protocolId == Guid.Empty)
        {
            return null;
        }

        return await context.TestProtocols.FindAsync([protocolId], ct);
    }

    public async Task<IReadOnlyList<TestProtocol>> GetByCropTypeAsync(string cropType, CancellationToken ct = default)
    {
        var trimmed = cropType?.Trim() ?? string.Empty;
        return await context.TestProtocols
            .Where(p => EF.Functions.ILike(p.CropType, trimmed))
            .ToListAsync(ct);
    }
}
