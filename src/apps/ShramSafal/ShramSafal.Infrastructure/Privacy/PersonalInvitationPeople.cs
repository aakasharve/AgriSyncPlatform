using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Privacy;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2 fix round 1 (review M-3, doctrine P6). The person a
/// personal invitation names — <c>person_name</c> and <c>invited_phone_e164</c>, what the OWNER typed about someone else —
/// is kept only while it is useful:
/// <list type="bullet">
/// <item><b>Retention</b> (<see cref="ForgetEndedAsync"/>, the nightly <c>RetentionSweepWorker</c>): 30 days after an
/// invitation ended (claimed, declined, withdrawn) or expired, both are cleared. An invitation only ever works for seven
/// days.</item>
/// <item><b>Erasure</b> (<see cref="ForgetNumbersAsync"/>, the <c>ErasureWorker</c>): when a person is erased — an account
/// (his login's number), or a worker's own identity (WID R8: his numbers and his farm records) — every invitation on every
/// farm naming him is cleared at once.</item>
/// </list>
/// The row itself stays (the farm's record of who it let in and with what grant: label, plots, authorities, who claimed it)
/// — never the seat, never the work. Both run on the worker's privileged connection under <c>SET LOCAL row_security = off</c>,
/// the way the other erasure steps do: on a connection RLS would filter, PostgreSQL refuses the statement instead of
/// quietly clearing nothing.
/// </summary>
public static class PersonalInvitationPeople
{
    /// <summary>How long after an invitation ended or expired its person is kept.</summary>
    public static readonly TimeSpan KeptAfterEnd = TimeSpan.FromDays(30);

    private const string ForgetEndedSql = @"
UPDATE ssf.farm_personal_invitations
   SET person_name = NULL, invited_phone_e164 = NULL
 WHERE (person_name IS NOT NULL OR invited_phone_e164 IS NOT NULL)
   AND ((status = 'Waiting' AND expires_at_utc < @cutoff)
     OR (status <> 'Waiting' AND COALESCE(ended_at_utc, claimed_at_utc, expires_at_utc) < @cutoff))";

    private const string ForgetNumbersSql = @"
UPDATE ssf.farm_personal_invitations
   SET person_name = NULL, invited_phone_e164 = NULL
 WHERE (person_name IS NOT NULL OR invited_phone_e164 IS NOT NULL)
   AND (invited_phone_e164 = ANY(@phones) OR field_operator_id = ANY(@records))";

    /// <summary>Clears the person on every invitation that ended or expired more than <see cref="KeptAfterEnd"/> ago.</summary>
    public static Task<int> ForgetEndedAsync(ShramSafalDbContext db, DateTime nowUtc, CancellationToken ct)
        => RunAsync(db, ForgetEndedSql, [new NpgsqlParameter("cutoff", nowUtc - KeptAfterEnd)], ct);

    /// <summary>
    /// Clears the person on every invitation naming one of <paramref name="phonesE164"/> (<c>+91…</c>) or one of the farm
    /// records <paramref name="fieldOperatorIds"/>, on every farm.
    /// </summary>
    public static Task<int> ForgetNumbersAsync(
        ShramSafalDbContext db, IReadOnlyCollection<string> phonesE164, IReadOnlyCollection<Guid> fieldOperatorIds, CancellationToken ct)
    {
        var phones = phonesE164.Where(p => !string.IsNullOrWhiteSpace(p)).Distinct().ToArray();
        var records = fieldOperatorIds.Where(id => id != Guid.Empty).Distinct().ToArray();
        if (phones.Length == 0 && records.Length == 0)
        {
            return Task.FromResult(0);
        }

        return RunAsync(db, ForgetNumbersSql,
            [new NpgsqlParameter("phones", phones), new NpgsqlParameter("records", records)], ct);
    }

    private static async Task<int> RunAsync(ShramSafalDbContext db, string sql, NpgsqlParameter[] parameters, CancellationToken ct)
    {
        var owned = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false) : null;
        try
        {
            await db.Database.ExecuteSqlRawAsync("SET LOCAL row_security = off", ct).ConfigureAwait(false);
            int cleared;
            try
            {
                cleared = await db.Database.ExecuteSqlRawAsync(sql, parameters, ct).ConfigureAwait(false);
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.InsufficientPrivilege)
            {
                throw new InvalidOperationException(
                    "Clearing the people personal invitations name cannot reach every farm's rows on this connection: "
                    + $"row-level security would filter ssf.farm_personal_invitations ({ex.MessageText}). It must run on the "
                    + "migration connection (ShramSafalDb_Migration), as an identity row-level security does not filter.",
                    ex);
            }

            if (owned is not null)
            {
                await owned.CommitAsync(ct).ConfigureAwait(false);
            }

            return cleared;
        }
        finally
        {
            if (owned is not null)
            {
                await owned.DisposeAsync().ConfigureAwait(false);
            }
        }
    }
}
