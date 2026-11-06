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
    /// them. No column, table, policy or grant changes. The deployed binary keeps working against the migrated schema: it
    /// checks first, so it never meets the index except in the race, where it now gets a clean refusal instead of a
    /// second row.</para>
    ///
    /// <para><b>Up() cleans first.</b> If any person already has several waiting requests, creating the index would fail
    /// the whole migration. So Up() keeps the OLDEST waiting request per person (the one whose date the person was told)
    /// and marks the others Cancelled (status 5) with <c>completed_at_utc</c> = now, exactly what the handler's own
    /// "cancel the others" does. Nothing is erased by this; a cancelled request erases nothing.</para>
    ///
    /// <para><b>Down() is lossless:</b> drops the index. The cancelled duplicates stay cancelled (they were never going to
    /// run twice). Never touches ssf.audit_events or any grant.</para>
    /// </summary>
    [DbContext(typeof(ShramSafalDbContext))]
    [Migration("20261105190000_AddOneWaitingErasureRequestIndex")]
    public partial class AddOneWaitingErasureRequestIndex : Migration
    {
        public const string IndexName = "ux_erasure_requests_one_waiting_per_person";

        public const string UpSql = @"
UPDATE ssf.erasure_requests e
   SET status = 5, completed_at_utc = now()
 WHERE e.status = 0
   AND EXISTS (
        SELECT 1 FROM ssf.erasure_requests o
         WHERE o.status = 0
           AND COALESCE(o.on_behalf_of_user_id, o.requested_by_user_id) = COALESCE(e.on_behalf_of_user_id, e.requested_by_user_id)
           AND (o.requested_at_utc, o.id) < (e.requested_at_utc, e.id));

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
