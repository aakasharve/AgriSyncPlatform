using System.Collections.Concurrent;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// CEI Phase 2 §4.5 — placeholder in-memory repository so the DI container can
/// resolve <see cref="ITestProtocolRepository"/>. Full EF-backed wiring lands
/// in CEI Phase 3 once <c>TestProtocol</c> is mapped onto
/// <see cref="ShramSafalDbContext"/>.
/// </summary>
internal sealed class InMemoryTestProtocolRepository : ITestProtocolRepository
{
    private static readonly ConcurrentDictionary<Guid, TestProtocol> _store = new();

    public Task AddAsync(TestProtocol protocol, CancellationToken ct = default)
    {
        _store[protocol.Id] = protocol;
        return Task.CompletedTask;
    }

    public Task<TestProtocol?> GetByIdAsync(Guid protocolId, CancellationToken ct = default)
    {
        _store.TryGetValue(protocolId, out var protocol);
        return Task.FromResult(protocol);
    }

    public Task<IReadOnlyList<TestProtocol>> GetByCropTypeAsync(string cropType, CancellationToken ct = default)
    {
        var trimmed = cropType?.Trim() ?? string.Empty;
        IReadOnlyList<TestProtocol> result = _store.Values
            .Where(p => string.Equals(p.CropType.Trim(), trimmed, StringComparison.OrdinalIgnoreCase))
            .ToList();
        return Task.FromResult(result);
    }
}
