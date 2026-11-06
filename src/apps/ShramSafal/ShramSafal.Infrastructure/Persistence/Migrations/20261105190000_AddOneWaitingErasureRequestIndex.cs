using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ShramSafal.Infrastructure.Persistence;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 lane OPS-1 (F99 leftover L-1) - the database itself allows only ONE waiting erasure request per
    /// person.
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE and a TIGHTENING: one partial unique index
    /// on <c>ssf.erasure_requests</c>, over the person the request is about (<c>COALESCE(on_behalf_of_user_id,
    /// requested_by_user_id)</c>) where <c>status = 0</c> (Requested = still waiting). Until now only the handler checked
    /// (F99 fix pass 2, N-1), so two requests arriving together could both be stored and "cancel" would end only one of
    /// them. No column, table, policy or grant changes.</para>
    ///
    /// <para><b>The binary already deployed.</b> It checks first, so it only meets the index in the race itself, where its insert is
    /// refused with an UNHANDLED 23505 and that one request answers HTTP 500 (the person asks again and is answered from the request
    /// that won). The new binary handles the refusal and answers the winner. Harmless, but not a "clean" refusal.</para>
    ///
    /// <para><b>Up() cleans first, and leaves a record.</b> If any person already has several waiting requests, creating the index would
    /// fail the whole migration. So Up() keeps the OLDEST waiting request per person (the one whose date the person was told) and marks
    /// the others Cancelled (status 5) with <c>completed_at_utc</c> = now, exactly what the handler's own "cancel the others" does - and for
    /// EACH one writes an <c>ssf.audit_events</c> row (actor <c>system_migration</c>; the payload carries the cancelled request id, the kept
    /// request id and this migration's id), because a rights request must not change state without a record of who and why (P3).
    /// <c>ssf.audit_events</c> is FORCE-RLS, which binds the owner-role migration connection too, so FORCE is lifted for that one insert and put
    /// back exactly as found (the 20261025204459 precedent). Nothing is erased by this; a cancelled request erases nothing.</para>
    ///
    /// <para><b>Down() is lossless:</b> drops the index. The cancelled duplicates (and their audit rows) stay. Never touches any grant.</para>
    /// </summary>
    [DbContext(typeof(ShramSafalDbContext))]
    [Migration("20261105190000_AddOneWaitingErasureRequestIndex")]
    public partial class AddOneWaitingErasureRequestIndex : Migration
    {
        public const string MigrationId = "20261105190000_AddOneWaitingErasureRequestIndex";
        public const string IndexName = "ux_erasure_requests_one_waiting_per_person";

        public const string UpSql = @"
DO $$
DECLARE
    v_audit_forced boolean;
BEGIN
    SELECT relforcerowsecurity INTO v_audit_forced
      FROM pg_class WHERE oid = 'ssf.audit_events'::regclass;

    CREATE TEMP TABLE _ops1_duplicate_waiting ON COMMIT DROP AS
    SELECT id, kept_id
      FROM (
            SELECT id,
                   first_value(id) OVER w AS kept_id,
                   row_number() OVER w AS rn
              FROM ssf.erasure_requests
             WHERE status = 0
            WINDOW w AS (PARTITION BY COALESCE(on_behalf_of_user_id, requested_by_user_id)
                         ORDER BY requested_at_utc, id)
           ) ranked
     WHERE rn > 1;

    IF v_audit_forced THEN
        ALTER TABLE ssf.audit_events NO FORCE ROW LEVEL SECURITY;
    END IF;

    INSERT INTO ssf.audit_events
        (""Id"", entity_type, entity_id, action, actor_user_id, actor_role, payload,
         occurred_at_utc, farm_id, client_command_id, app_version, device_id, ip_hash, source_ai_job_id)
    SELECT gen_random_uuid(),
           'ErasureRequest',
           d.id,
           'CancelledDuplicateWaiting',
           'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
           'system_migration',
           json_build_object(
               'requestId', d.id,
               'keptRequestId', d.kept_id,
               'migrationId', '" + MigrationId + @"',
               'reason', 'one_waiting_request_per_person')::text,
           now(),
           NULL,
           NULL,
           'migration',
           'migration',
           'sha256:migration',
           NULL
      FROM _ops1_duplicate_waiting d;

    IF v_audit_forced THEN
        ALTER TABLE ssf.audit_events FORCE ROW LEVEL SECURITY;
    END IF;

    UPDATE ssf.erasure_requests e
       SET status = 5, completed_at_utc = now()
      FROM _ops1_duplicate_waiting d
     WHERE e.id = d.id;
END
$$;

CREATE UNIQUE INDEX " + IndexName + @"
    ON ssf.erasure_requests ((COALESCE(on_behalf_of_user_id, requested_by_user_id)))
 WHERE status = 0;";

        public const string DownSql = "DROP INDEX IF EXISTS ssf." + IndexName + ";";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql(UpSql);

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.Sql(DownSql);
    }
}
