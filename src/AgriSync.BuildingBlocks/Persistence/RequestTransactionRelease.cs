// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, F36)
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace AgriSync.BuildingBlocks.Persistence;

/// <summary>
/// Lets a handler run a slow call that never touches the database (an AI provider, a transcriber, a retry
/// back-off) WITHOUT the request's database connections staying checked out while it waits.
///
/// <para><b>Why.</b> <see cref="TenantTransactionMiddleware"/> opens one transaction per tenant-scoped
/// context at the start of every business request, and a transaction owns its connection. A voice parse that
/// waits 20 to 60 seconds on the model therefore held two pooled connections for that whole time, so about 32
/// such requests exhausted the pool (register row F36).</para>
///
/// <para><b>What it does.</b> <see cref="RunWithoutConnectionsAsync{T}"/> commits what has been saved so far,
/// disposes the transactions (the connections go back to the pool), awaits the work, then begins fresh
/// transactions on the same contexts. The tenant interceptor stamps the farm/user claim on every command, so
/// the new transactions carry the same scope. Anything the caller has NOT saved stays tracked and is saved in
/// the new transaction. It is a no-op when no request transaction is open (skip-listed routes, jobs, tests).</para>
///
/// <para><b>Rule for callers.</b> The work must not use any DbContext of this request, and the caller must have
/// saved any row that must survive a failure of the work. Committing early means a later failure no longer
/// rolls back what was saved before the call; for the AI path that is intended (the job row records the
/// attempt).</para>
/// </summary>
public sealed class RequestTransactionRelease
{
    private IReadOnlyList<DbContext> _contexts = Array.Empty<DbContext>();
    private List<IDbContextTransaction> _transactions = new();
    private bool _attached;

    /// <summary>The transactions the middleware must commit or roll back when the request ends.</summary>
    internal IReadOnlyList<IDbContextTransaction> CurrentTransactions => _transactions;

    /// <summary>How many times the connections were handed back during this request (for tests and logs).</summary>
    public int ReleaseCount { get; private set; }

    internal void Attach(IReadOnlyList<DbContext> contexts, List<IDbContextTransaction> transactions)
    {
        _contexts = contexts;
        _transactions = transactions;
        _attached = true;
    }

    public async Task<T> RunWithoutConnectionsAsync<T>(Func<Task<T>> work, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(work);
        if (!_attached || _transactions.Count == 0)
        {
            return await work();
        }

        // Commit in order. If a commit throws, the list still holds the transactions, so the middleware rolls
        // back and disposes them as it would have without this call.
        var toRelease = _transactions.ToArray();
        foreach (var tx in toRelease)
        {
            await tx.CommitAsync(ct);
        }

        _transactions.Clear();
        foreach (var tx in toRelease)
        {
            await tx.DisposeAsync();
        }

        ReleaseCount++;
        try
        {
            return await work();
        }
        finally
        {
            // Re-open even when the work threw or was cancelled: the middleware still has to commit or roll
            // back "the request's transactions", and later handler code in this request still needs them.
            // CancellationToken.None on purpose: a cancelled request token must not leave the request without
            // a transaction while the middleware unwinds.
            foreach (var db in _contexts)
            {
                _transactions.Add(await db.Database.BeginTransactionAsync(CancellationToken.None));
            }
        }
    }

    public Task RunWithoutConnectionsAsync(Func<Task> work, CancellationToken ct) =>
        RunWithoutConnectionsAsync(async () =>
        {
            await work();
            return 0;
        }, ct);
}
