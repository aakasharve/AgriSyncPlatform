// spec: plr-d10-redesign-real-integration-2026-10-25 (I27)
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Privacy.Ports;

namespace ShramSafal.Infrastructure.Privacy;

/// <summary>
/// Runs <see cref="IImprovementPermissionStore.IsAccountErasureRequestedAsync"/> — the one existing
/// erasure check — in a fresh DI scope: its own tenant context, its own DbContext and connection,
/// its own transaction. The store establishes the person's identity there (self-only RLS on the
/// erasure ledger) without touching the request that asked, which may be running as someone else
/// and may not change identity (a user-scoped request refuses to elevate).
/// </summary>
internal sealed class IsolatedAccountErasureCheck(IServiceScopeFactory scopes) : IAccountErasureCheck
{
    public async Task<bool> IsErasureRequestedAsync(Guid userId, CancellationToken ct = default)
    {
        await using var scope = scopes.CreateAsyncScope();
        return await scope.ServiceProvider
            .GetRequiredService<IImprovementPermissionStore>()
            .IsAccountErasureRequestedAsync(userId, ct)
            .ConfigureAwait(false);
    }
}
