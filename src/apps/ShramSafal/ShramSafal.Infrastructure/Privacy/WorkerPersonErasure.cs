using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ShramSafal.Domain.Identity;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Privacy;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID, rule R8 (founder D-71). The erasure worker's pass for a
/// WORKER's ShramSafal identity: a person whose erasure was asked (by an owner, on his behalf) and whose wait has passed
/// (30 days by default, the same <c>ErasureTiming</c> as an account's) is anonymised — the name on his card, his PIN, every
/// phone number, every card code (retired, never reused), the numbers his codes went to, and the name on every farm record
/// that is him (the existing <see cref="ErasureWorker.AnonymizeFieldOperatorAsync"/>). <b>Never the work</b> (P6): every
/// farm record, work row, हजेरी mark and headcount keeps its id, dates and numbers.
/// </summary>
/// <remarks>
/// <para><b>Fix pass 1 (review M1): never silent on a connection row-level security filters.</b> Every read and write
/// runs under <c>SET LOCAL row_security = off</c>, the way the F1 scrub does (<c>ErasureWorker.ScrubDailyLogContentWordsAsync</c>):
/// on an identity RLS would filter, PostgreSQL then REFUSES the statement instead of quietly showing no rows, and the
/// pass throws, naming why. It never reports "nothing due" over rows it could not see.</para>
/// Runs on the worker's privileged admin context, as every other erasure step does. The claim is ONE guarded UPDATE (still
/// waiting, wait passed, not yet erased), so an owner's cancel and this pass can never both win. Each person is one
/// transaction; a person whose anonymisation touches no person row fails loudly instead of being recorded as erased.
/// </remarks>
internal static class WorkerPersonErasure
{
    private const int BatchSize = 10;

    public static async Task<int> RunAsync(
        IServiceProvider sp, DateTime dueIfRequestedAtOrBefore, DateTime nowUtc, ILogger logger, CancellationToken ct)
    {
        var adminFactory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
        await using var admin = await adminFactory.CreateAsync(
            reason: $"{nameof(ErasureWorker)}.worker-persons",
            actorUserId: SystemActor.ErasedFarmer,
            ct: ct).ConfigureAwait(false);
        return await RunAsync(admin, dueIfRequestedAtOrBefore, nowUtc, logger, ct).ConfigureAwait(false);
    }

    /// <summary>The pass on a given context (the worker's admin context; a test hands it any identity).</summary>
    internal static async Task<int> RunAsync(
        ShramSafalDbContext admin, DateTime dueIfRequestedAtOrBefore, DateTime nowUtc, ILogger logger, CancellationToken ct)
    {
        List<Guid> due;
        await using (var read = await admin.Database.BeginTransactionAsync(ct).ConfigureAwait(false))
        {
            await RowSecurityOffAsync(admin, ct).ConfigureAwait(false);
            due = await Unfiltered(() => admin.ShramPersons
                .Where(p => p.ErasedAtUtc == null && p.ErasureRequestedAtUtc != null && p.ErasureRequestedAtUtc <= dueIfRequestedAtOrBefore)
                .OrderBy(p => p.ErasureRequestedAtUtc)
                .Select(p => p.Id)
                .Take(BatchSize)
                .ToListAsync(ct)).ConfigureAwait(false);
            await read.CommitAsync(ct).ConfigureAwait(false);
        }

        var erased = 0;
        foreach (var personId in due)
        {
            if (await EraseOneAsync(admin, personId, dueIfRequestedAtOrBefore, nowUtc, ct).ConfigureAwait(false))
            {
                erased++;
                logger.LogInformation("Worker identity {PersonId} erased (the person, never the work).", personId);
            }
        }

        return erased;
    }

    private static async Task<bool> EraseOneAsync(
        ShramSafalDbContext admin, Guid personId, DateTime dueIfRequestedAtOrBefore, DateTime nowUtc, CancellationToken ct)
    {
        await using var transaction = await admin.Database.BeginTransactionAsync(ct).ConfigureAwait(false);
        await RowSecurityOffAsync(admin, ct).ConfigureAwait(false);

        // The claim: still waiting, its wait passed, not erased. Zero rows = cancelled meanwhile, or taken by another pass.
        var claimed = await admin.ShramPersons
            .Where(p => p.Id == personId && p.ErasedAtUtc == null
                && p.ErasureRequestedAtUtc != null && p.ErasureRequestedAtUtc <= dueIfRequestedAtOrBefore)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.ErasedAtUtc, nowUtc), ct)
            .ConfigureAwait(false);
        if (claimed == 0)
        {
            await transaction.RollbackAsync(ct).ConfigureAwait(false);
            return false;
        }

        // He and every alias merged into him (case 9) are one human.
        var group = await admin.ShramPersons
            .Where(p => p.Id == personId || p.MergedIntoPersonId == personId)
            .ToListAsync(ct)
            .ConfigureAwait(false);
        var ids = group.Select(p => p.Id).ToList();
        foreach (var person in group)
        {
            person.Anonymise(nowUtc);
        }

        foreach (var phone in await admin.ShramPersonPhones.Where(p => ids.Contains(p.PersonId)).ToListAsync(ct).ConfigureAwait(false))
        {
            phone.Erase(nowUtc);
        }

        foreach (var card in await admin.ShramCards.Where(c => ids.Contains(c.PersonId)).ToListAsync(ct).ConfigureAwait(false))
        {
            card.Retire(nowUtc, null);
        }

        foreach (var challenge in await admin.ShramPhoneChallenges.Where(c => ids.Contains(c.PersonId)).ToListAsync(ct).ConfigureAwait(false))
        {
            challenge.ErasePhone();
        }

        var records = await admin.FieldOperators
            .Where(f => f.PersonId != null && ids.Contains(f.PersonId.Value))
            .Select(f => new { f.Id, Farm = f.OriginatingFarmId })
            .ToListAsync(ct)
            .ConfigureAwait(false);

        await admin.SaveChangesAsync(ct).ConfigureAwait(false);

        foreach (var record in records)
        {
            await ErasureWorker.AnonymizeFieldOperatorAsync(admin, record.Id, ct).ConfigureAwait(false);
            await admin.ShramIdentityEvents.AddAsync(ShramIdentityEvent.Record(
                Guid.NewGuid(), record.Farm.Value, record.Id, personId, IdentityEventKind.Erased, IdentityProof.None,
                SystemActor.ErasedFarmer, nowUtc), ct).ConfigureAwait(false);
        }

        await admin.SaveChangesAsync(ct).ConfigureAwait(false);

        var left = await admin.ShramPersons
            .CountAsync(p => ids.Contains(p.Id) && p.CardName != ShramPerson.ErasedName, ct)
            .ConfigureAwait(false);
        if (left != 0)
        {
            throw new InvalidOperationException(
                $"Worker identity {personId}: {left} person row(s) still carry a name after anonymisation; nothing is recorded as erased.");
        }

        await transaction.CommitAsync(ct).ConfigureAwait(false);
        return true;
    }

    /// <summary>RLS may not quietly hide a row from this pass: with it off, a filtered identity is refused instead.</summary>
    private static Task RowSecurityOffAsync(ShramSafalDbContext admin, CancellationToken ct)
        => admin.Database.ExecuteSqlRawAsync("SET LOCAL row_security = off", ct);

    private static async Task<T> Unfiltered<T>(Func<Task<T>> read)
    {
        try
        {
            return await read().ConfigureAwait(false);
        }
        catch (Npgsql.PostgresException ex) when (ex.SqlState == Npgsql.PostgresErrorCodes.InsufficientPrivilege)
        {
            throw new InvalidOperationException(
                "Worker-identity erasure cannot read every person on this connection: row-level security would filter "
                + $"ssf.shram_persons ({ex.MessageText}). It must run on the migration connection (ShramSafalDb_Migration), "
                + "as an identity row-level security does not filter.",
                ex);
        }
    }
}
