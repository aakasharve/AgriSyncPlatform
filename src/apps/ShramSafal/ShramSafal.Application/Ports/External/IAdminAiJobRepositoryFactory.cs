namespace ShramSafal.Application.Ports.External;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1 (review F-5). The admin AI dashboard counts jobs
/// across EVERY farm. Its route runs admin-elevated (the middleware's admin skip-list), which sets no tenant GUC, so under
/// FORCE RLS the request's own repository would count nothing. This opens an AI job repository over a privileged context
/// from <c>IAdminDbContextFactory</c> (no tenant interceptor; every opening is audited), for an admin route only, after its
/// own admin gate has passed.
/// </summary>
public interface IAdminAiJobRepositoryFactory
{
    /// <summary>An AI job repository over a fresh, audited, privileged context; the context lives until the request ends.</summary>
    Task<IAiJobRepository> CreateAsync(string reason, Guid actorUserId, CancellationToken ct = default);
}
