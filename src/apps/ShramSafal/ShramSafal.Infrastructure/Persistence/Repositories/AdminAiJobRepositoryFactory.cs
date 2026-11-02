using AgriSync.BuildingBlocks.Persistence;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1 (review F-5). See
/// <see cref="IAdminAiJobRepositoryFactory"/>. Scoped: every privileged context it opens is disposed when the request ends.
/// </summary>
internal sealed class AdminAiJobRepositoryFactory(IAdminDbContextFactory<ShramSafalDbContext> adminDbContextFactory)
    : IAdminAiJobRepositoryFactory, IAsyncDisposable
{
    private readonly List<ShramSafalDbContext> _opened = [];

    public async Task<IAiJobRepository> CreateAsync(string reason, Guid actorUserId, CancellationToken ct = default)
    {
        var context = await adminDbContextFactory.CreateAsync(reason, actorUserId, ct);
        _opened.Add(context);
        return new AiJobRepository(context);
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var context in _opened)
        {
            await context.DisposeAsync();
        }

        _opened.Clear();
    }
}
