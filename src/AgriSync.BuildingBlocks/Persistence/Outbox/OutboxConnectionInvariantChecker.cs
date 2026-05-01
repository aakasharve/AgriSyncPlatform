using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace AgriSync.BuildingBlocks.Persistence.Outbox;

/// <summary>
/// T-IGH-03-OUTBOX-WIRING hardening: verifies the hard deployment
/// invariant that <see cref="OutboxDbContext"/> AND every writing
/// DbContext that maps an OutboxMessage entity all point at the same
/// physical Postgres database (host + port + database name).
///
/// <para>
/// The current configuration cross-schema-writes from
/// <c>UserDbContext</c> and <c>AccountsDbContext</c> into
/// <c>ssf.outbox_messages</c> (owned by <c>ShramSafalDbContext</c>).
/// That only works if all four contexts are pointed at the same
/// physical database. A future deploy that splits them onto separate
/// DBs would silently break event delivery for User and Accounts —
/// their writes would land in their own database's
/// <c>ssf.outbox_messages</c>, which the dispatcher (configured
/// against ShramSafal's connection) would never poll.
/// </para>
///
/// <para>
/// This checker runs once at host startup, compares the writing
/// contexts' connection strings against the OutboxDbContext's, and
/// logs a loud warning if they diverge on host / port / database.
/// It does NOT throw — a divergent deploy might be intentional during
/// a migration window — but the warning is loud enough to surface in
/// any sane production logging stack.
/// </para>
/// </summary>
public sealed class OutboxConnectionInvariantChecker : IHostedService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<OutboxConnectionInvariantChecker> _logger;

    public OutboxConnectionInvariantChecker(
        IServiceProvider services,
        ILogger<OutboxConnectionInvariantChecker> logger)
    {
        _services = services;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _services.CreateScope();

            var outboxCtx = scope.ServiceProvider.GetService<OutboxDbContext>();
            if (outboxCtx is null)
            {
                _logger.LogDebug(
                    "OutboxConnectionInvariantChecker: OutboxDbContext not registered; skipping invariant check.");
                return Task.CompletedTask;
            }

            var outboxFingerprint = TryGetFingerprint(outboxCtx);
            if (outboxFingerprint is null)
            {
                _logger.LogDebug(
                    "OutboxConnectionInvariantChecker: OutboxDbContext is not Npgsql; skipping invariant check.");
                return Task.CompletedTask;
            }

            // Walk every DbContext registered in the container that
            // maps the OutboxMessage entity. Compare its connection
            // string fingerprint against the OutboxDbContext's. We
            // don't enumerate types via reflection-on-DI; instead we
            // resolve every IDbContextOptions<TContext> via a marker
            // service we don't have, so we use a simpler heuristic:
            // the test of the invariant only needs to fire if and
            // when one of the writing contexts is actually used. To
            // keep startup work bounded, we resolve the THREE known
            // writing context types (ShramSafal, User, Accounts) by
            // their CLR-name via the service provider, only if the
            // user has wired them.
            var knownWritingContextTypeNames = new[]
            {
                "ShramSafal.Infrastructure.Persistence.ShramSafalDbContext",
                "User.Infrastructure.Persistence.UserDbContext",
                "Accounts.Infrastructure.Persistence.AccountsDbContext"
            };

            var divergent = new List<string>();
            foreach (var typeName in knownWritingContextTypeNames)
            {
                var contextType = ResolveTypeAcrossLoadedAssemblies(typeName);
                if (contextType is null)
                {
                    continue;
                }
                var ctx = scope.ServiceProvider.GetService(contextType) as DbContext;
                if (ctx is null)
                {
                    continue;
                }
                var fingerprint = TryGetFingerprint(ctx);
                if (fingerprint is null)
                {
                    continue;
                }
                if (!fingerprint.Equals(outboxFingerprint))
                {
                    divergent.Add($"{typeName} -> {fingerprint}");
                }
            }

            if (divergent.Count > 0)
            {
                _logger.LogWarning(
                    "T-IGH-03-OUTBOX-WIRING shared-DB invariant VIOLATED. The OutboxDbContext (host+port+db = {OutboxFingerprint}) does NOT match {Count} writing DbContext(s): {Divergent}. " +
                    "Domain events raised through those writing contexts will land in a DIFFERENT physical database's outbox_messages table than the dispatcher polls; they will never publish. " +
                    "Either point all DbContexts at the same database, or extend OutboxDispatcher to poll multiple sources.",
                    outboxFingerprint,
                    divergent.Count,
                    string.Join("; ", divergent));
            }
            else
            {
                _logger.LogInformation(
                    "T-IGH-03-OUTBOX-WIRING shared-DB invariant OK. All writing DbContexts share host+port+db with the OutboxDbContext ({OutboxFingerprint}).",
                    outboxFingerprint);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "OutboxConnectionInvariantChecker: invariant check failed; this is non-fatal but should be investigated.");
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private static string? TryGetFingerprint(DbContext context)
    {
        var connStr = context.Database.GetConnectionString();
        if (string.IsNullOrWhiteSpace(connStr))
        {
            return null;
        }
        try
        {
            // Parse the Npgsql-style connection string by hand to
            // avoid taking an Npgsql dependency in BuildingBlocks
            // (the project deliberately stays provider-neutral).
            // Connection strings are key=value pairs separated by `;`,
            // case-insensitive on keys; we only care about
            // host/port/database to fingerprint the physical database.
            string? host = null;
            string? db = null;
            string? port = null;

            foreach (var segment in connStr.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var eq = segment.IndexOf('=');
                if (eq <= 0)
                {
                    continue;
                }
                var key = segment.Substring(0, eq).Trim().ToLowerInvariant();
                var value = segment.Substring(eq + 1).Trim();
                switch (key)
                {
                    case "host":
                    case "server":
                    case "data source":
                        host = value;
                        break;
                    case "port":
                        port = value;
                        break;
                    case "database":
                    case "initial catalog":
                        db = value;
                        break;
                }
            }

            if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(db))
            {
                return null;
            }
            return $"{host.ToLowerInvariant()}:{port ?? "5432"}/{db.ToLowerInvariant()}";
        }
        catch
        {
            return null;
        }
    }

    private static Type? ResolveTypeAcrossLoadedAssemblies(string fullyQualifiedTypeName)
    {
        foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
        {
            try
            {
                var t = asm.GetType(fullyQualifiedTypeName, throwOnError: false);
                if (t is not null)
                {
                    return t;
                }
            }
            catch
            {
                // ignore — keep scanning
            }
        }
        return null;
    }
}
