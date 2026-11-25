using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports.External;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Creators;

// spec: plr-d10 schedule slice 15 (the creator door), server half; doctrine P6 (anonymise the person, never the work).
//
// Both acts here run on the migration-role context (the one identity row security does not filter), with the whole transaction under SET LOCAL row_security = off:
// a connection row security WOULD filter raises an error instead of touching none of the rows and reporting success.

/// <summary>What a creator's erasure changed. <c>FilesLeft</c>: files the storage refused to delete (their rows are gone; counted, never hidden).</summary>
public readonly record struct CreatorErasureOutcome(int Profiles, int Files, int Drafts, int Sessions, int Codes, int FilesLeft)
{
    public int Rows => Profiles + Files + Drafts + Sessions + Codes;
}

public static class CreatorDoorErasure
{
    /// <summary>
    /// Erases one creator (the id of his profile). His phone and name go (the row stays as an opaque id, status erased); his files (rows and bytes), his unsent
    /// drafts, his sessions and his sign-in codes are deleted. KEPT: every round he SENT, with its body and what staff decided about it (the history of a check),
    /// his agreement to the terms (an opaque id, a version and a time), and every library row made from his approved work, whose maker is now an id with no person
    /// behind it. For an id that is no creator it changes nothing and returns zeros. Idempotent.
    /// </summary>
    public static async Task<CreatorErasureOutcome> EraseAsync(
        ShramSafalDbContext db, IAttachmentStorageService? storage, Guid creatorId, ILogger logger, CancellationToken ct)
    {
        List<string> keys;
        int profiles, files, drafts, sessions, codes;
        await using (var tx = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false))
        {
            await db.Database.ExecuteSqlRawAsync("SET LOCAL row_security = off", ct).ConfigureAwait(false);
            try
            {
                keys = await db.Database
                    .SqlQueryRaw<string>(@"SELECT storage_key AS ""Value"" FROM ssf.creator_files WHERE creator_id = {0} AND state <> 2", creatorId)
                    .ToListAsync(ct)
                    .ConfigureAwait(false);
                files = await db.Database.ExecuteSqlRawAsync("DELETE FROM ssf.creator_files WHERE creator_id = {0}", [creatorId], ct).ConfigureAwait(false);
                drafts = await db.Database.ExecuteSqlRawAsync("DELETE FROM ssf.creator_submissions WHERE creator_id = {0} AND state = 0", [creatorId], ct).ConfigureAwait(false);
                sessions = await db.Database.ExecuteSqlRawAsync("DELETE FROM ssf.creator_sessions WHERE creator_id = {0}", [creatorId], ct).ConfigureAwait(false);
                codes = await db.Database.ExecuteSqlRawAsync(
                    "DELETE FROM ssf.creator_sign_in_codes WHERE phone = (SELECT p.phone FROM ssf.creator_profiles p WHERE p.id = {0})", [creatorId], ct).ConfigureAwait(false);
                profiles = await db.Database.ExecuteSqlRawAsync(
                    "UPDATE ssf.creator_profiles SET phone = NULL, display_name = {1}, status = 3, erased_at_utc = now(), modified_at_utc = now() WHERE id = {0} AND status <> 3",
                    [creatorId, Domain.Creators.CreatorProfile.ErasedName],
                    ct).ConfigureAwait(false);
            }
            catch (Npgsql.PostgresException ex) when (ex.SqlState == Npgsql.PostgresErrorCodes.InsufficientPrivilege)
            {
                throw new InvalidOperationException(
                    "Erasure cannot reach the creator tables on this connection: row-level security would filter them "
                    + $"({ex.MessageText}). It must run on the migration connection (ShramSafalDb_Migration), as an identity row-level security does not filter.",
                    ex);
            }

            var left = await db.Database
                .SqlQueryRaw<int>(
                    @"SELECT ((SELECT count(*) FROM ssf.creator_files WHERE creator_id = {0})
                            + (SELECT count(*) FROM ssf.creator_profiles WHERE id = {0} AND (phone IS NOT NULL OR status <> 3)))::int AS ""Value""",
                    creatorId)
                .SingleAsync(ct)
                .ConfigureAwait(false);
            if (left != 0)
            {
                throw new InvalidOperationException($"Erasure left {left} row(s) of the erased creator; refusing to report success.");
            }

            await tx.CommitAsync(ct).ConfigureAwait(false);
        }

        var filesLeft = await DeleteBytesAsync(storage, keys, logger, ct).ConfigureAwait(false);
        return new CreatorErasureOutcome(profiles, files, drafts, sessions, codes, filesLeft);
    }

    /// <summary>
    /// Removes every draft whose ninety days have passed, with the files attached to that round. A round that was sent never expires. Returns the drafts removed.
    /// </summary>
    public static async Task<int> SweepExpiredDraftsAsync(
        ShramSafalDbContext db, IAttachmentStorageService? storage, DateTime nowUtc, ILogger logger, CancellationToken ct)
    {
        List<string> keys;
        int drafts;
        await using (var tx = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false))
        {
            await db.Database.ExecuteSqlRawAsync("SET LOCAL row_security = off", ct).ConfigureAwait(false);
            const string expired = "SELECT s.id FROM ssf.creator_submissions s WHERE s.state = 0 AND s.expires_at_utc <= {0}";
            try
            {
                keys = await db.Database
                    .SqlQueryRaw<string>($@"SELECT f.storage_key AS ""Value"" FROM ssf.creator_files f WHERE f.state <> 2 AND f.submission_id IN ({expired})", nowUtc)
                    .ToListAsync(ct)
                    .ConfigureAwait(false);
                await db.Database.ExecuteSqlRawAsync($"DELETE FROM ssf.creator_files WHERE submission_id IN ({expired})", [nowUtc], ct).ConfigureAwait(false);
                drafts = await db.Database.ExecuteSqlRawAsync("DELETE FROM ssf.creator_submissions WHERE state = 0 AND expires_at_utc <= {0}", [nowUtc], ct).ConfigureAwait(false);
            }
            catch (Npgsql.PostgresException ex) when (ex.SqlState == Npgsql.PostgresErrorCodes.InsufficientPrivilege)
            {
                throw new InvalidOperationException(
                    $"The draft expiry cannot reach the creator tables on this connection: row-level security would filter them ({ex.MessageText}).", ex);
            }

            await tx.CommitAsync(ct).ConfigureAwait(false);
        }

        await DeleteBytesAsync(storage, keys, logger, ct).ConfigureAwait(false);
        return drafts;
    }

    private static async Task<int> DeleteBytesAsync(IAttachmentStorageService? storage, List<string> keys, ILogger logger, CancellationToken ct)
    {
        var filesLeft = 0;
        foreach (var key in keys.Distinct(StringComparer.Ordinal))
        {
            try
            {
                if (storage is null)
                {
                    throw new InvalidOperationException("No file storage is registered.");
                }

                await storage.DeleteAsync(key, ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                filesLeft++;
                logger.LogError(ex, "Creator door: a file could not be deleted from storage (key {StorageKey}). Its row is gone; the file is left in storage and is counted.", key);
            }
        }

        return filesLeft;
    }
}

/// <summary>
/// Once a day, removes the creator drafts whose ninety days have passed (and their files). The host adds it only while the creator door is switched on.
/// A failed pass is logged and tried again the next day; it never stops the host.
/// </summary>
public sealed class CreatorDraftExpiryJob(IServiceScopeFactory scopeFactory, ILogger<CreatorDraftExpiryJob> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var sp = scope.ServiceProvider;
                var factory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
                await using var admin = await factory.CreateAsync($"{nameof(CreatorDraftExpiryJob)}.sweep", AgriSync.BuildingBlocks.Auditing.SystemActor.Worker, stoppingToken).ConfigureAwait(false);
                var removed = await CreatorDoorErasure
                    .SweepExpiredDraftsAsync(admin, sp.GetService<IAttachmentStorageService>(), DateTime.UtcNow, logger, stoppingToken)
                    .ConfigureAwait(false);
                if (removed > 0)
                {
                    logger.LogInformation("Creator door: {Count} draft(s) past their ninety days were removed with their files.", removed);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Creator door: the draft expiry pass failed; it is tried again tomorrow.");
            }

            try
            {
                await Task.Delay(TimeSpan.FromHours(24), stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
