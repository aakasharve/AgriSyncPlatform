// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (P0.9-blob-linkage)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// §P0.9 — give raw blobs a subject linkage.
    ///
    /// <para>
    /// <b>The problem.</b> <c>ssf.raw_blob_index</c> has no subject dimension.
    /// The only pointer from a farmer to their raw audio was
    /// <c>ssf.ai_jobs.raw_input_ref</c> / <c>ai_jobs.input_content_hash</c>, and
    /// the DPDP erasure cascade runs
    /// <c>DELETE FROM ssf.ai_jobs WHERE user_id = X</c> (ErasureWorker step 2).
    /// After that statement the S3 object still exists and nothing in the system
    /// can say whose voice it is. The bytes survive, unattributable, forever.
    /// Waiting makes this permanently unfixable rather than merely larger: every
    /// erasure between now and the fix destroys a link that cannot be rebuilt.
    /// </para>
    ///
    /// <para>
    /// <b>Why a join table rather than a column on <c>raw_blob_index</c>.</b>
    /// The blob store is content-addressed (PK = sha256) and ref-counted, so two
    /// farmers can legitimately land on the same row. Subject↔blob is
    /// many-to-many by construction. A scalar <c>user_id</c> would silently lose
    /// the second subject the first time one clip is uploaded under another
    /// account — and erasing farmer A would then either destroy farmer B's
    /// evidence or spare it invisibly. Reversing that later would be a data
    /// migration on the exact table whose whole purpose is surviving erasure.
    /// </para>
    ///
    /// <para>
    /// <b>Scope: linkage only.</b> This migration does not delete raw audio, does
    /// not set a retention period and does not add an S3 lifecycle rule.
    /// Raw-audio retention and erasure design is deferred to counsel (§17
    /// L1644). What lands here is the record that keeps that future decision
    /// POSSIBLE. (Independently: production holds no <c>s3:DeleteObject</c>
    /// permission on either media bucket, so erasure-deletion is not executable
    /// today regardless of policy.)
    /// </para>
    ///
    /// <para>
    /// <b>RLS.</b> <c>FORCE ROW LEVEL SECURITY</c> with a user-keyed policy,
    /// following <c>p_user_correction_events</c> and ADR 0020 (every tenant-GUC
    /// cast is <c>NULLIF</c>-wrapped, so an empty GUC fails closed rather than
    /// raising <c>22P02</c>). Two choices in that policy are load-bearing:
    /// </para>
    /// <list type="number">
    /// <item><description>
    /// <b>The <c>USING</c> clause does NOT reference <c>ssf.ai_jobs</c>.</b> The
    /// sibling policy <c>p_tenant_raw_blob_index</c> EXISTS-joins to
    /// <c>ai_jobs</c>, which means that once an erasure deletes the job rows the
    /// index row becomes not merely unattributable but invisible. Inheriting
    /// that shape here would reproduce the exact defect this table exists to
    /// fix, so the policy keys on this table's own <c>user_id</c>.
    /// </description></item>
    /// <item><description>
    /// <b><c>WITH CHECK (true)</c>, matching <c>raw_blob_index</c>.</b> The
    /// linkage is written from <c>AiOrchestrator.TryPersistRawBlobAsync</c>,
    /// whose body is deliberately wrapped in catch-and-swallow so a cold-tier
    /// storage failure never fails the farmer's voice parse. A <c>WITH CHECK</c>
    /// bound to the <c>agrisync.user_id</c> GUC would therefore convert any flow
    /// that leaves that GUC empty — <c>TenantConnectionInterceptor</c> explicitly
    /// permits this ("UserId may be unset for some flows; emit empty string") —
    /// into a SILENTLY unlinked blob: insert throws, catch swallows, bytes land
    /// in S3 with no subject. That is precisely the failure this task exists to
    /// eliminate, so writes are unconditional and reads are what RLS constrains.
    /// The value written is not GUC-derived in any case; it is the authenticated
    /// <c>userId</c> parameter already in scope at the call site.
    /// </description></item>
    /// </list>
    ///
    /// <para>
    /// <b>The backfill is best-effort and states what it could not do.</b>
    /// Existing <c>raw_blob_index</c> rows have no subject. The linkage is
    /// recoverable for rows whose <c>ai_jobs</c> row still exists (join on
    /// either recorded hash). A blob whose <c>ai_jobs</c> row is already gone is
    /// unrecoverable BY DEFINITION — that is the damage already done, which this
    /// migration exists to stop growing. Unrecoverable rows are counted and
    /// RAISEd as a NOTICE: they are not fabricated an owner, and they are not
    /// quietly skipped.
    /// </para>
    ///
    /// <para>
    /// <b>Down() drops the table.</b> It restores the schema, not the knowledge.
    /// Re-running Up() after a Down() recovers only what <c>ai_jobs</c> can still
    /// prove, and that shrinks with every erasure.
    /// </para>
    /// </summary>
    public partial class AddRawBlobSubjects : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── 1. The table ─────────────────────────────────────────────
            //
            // Scaffolded from RawBlobSubjectConfiguration, which gives every
            // property an explicit HasColumnName. The ShramSafal context
            // configures NO snake_case convention, so a property without one is
            // addressed in PascalCase against a snake_case table and every
            // statement throws 42703. ssf.correction_events shipped exactly that
            // way and never held a single row in its production life. Keeping
            // this operation model-generated (rather than hand-rolled SQL) is
            // what guarantees the physical column names and the EF mapping came
            // from the same source.
            migrationBuilder.CreateTable(
                name: "raw_blob_subjects",
                schema: "ssf",
                columns: table => new
                {
                    sha256 = table.Column<string>(type: "character varying(64)", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    first_seen_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    // Composite PK == the idempotency key. A repeat persist of
                    // the same blob by the same subject conflicts here and is a
                    // no-op; it must never produce a second row.
                    table.PrimaryKey("PK_raw_blob_subjects", x => new { x.sha256, x.user_id });
                    table.ForeignKey(
                        name: "fk_raw_blob_subjects_sha256",
                        column: x => x.sha256,
                        principalSchema: "ssf",
                        principalTable: "raw_blob_index",
                        principalColumn: "sha256",
                        onDelete: ReferentialAction.Cascade);
                });

            // The only query that will ever matter: every blob belonging to
            // this subject (the DPDP §11 access / §12 erasure lookup).
            migrationBuilder.CreateIndex(
                name: "ix_raw_blob_subjects_user_id",
                schema: "ssf",
                table: "raw_blob_subjects",
                column: "user_id");

            // ── 2. Backfill from ai_jobs, honestly ───────────────────────
            //
            // Two recorded links exist between an AiJob and a blob, populated by
            // different code paths, so both are used:
            //   raw_input_ref      — stamped by AiOrchestrator from
            //                        blobRef.Sha256; matched with LIKE to mirror
            //                        the existing p_tenant_raw_blob_index policy,
            //                        which allows for a prefixed form.
            //   input_content_hash — the hash ErasureWorker itself collects.
            // Neither is invented. A row appears here only because ai_jobs had
            // already asserted that relationship.
            //
            // FORCE RLS applies to the table owner too, and the tenant GUCs are
            // unset during a migration, so both policies would match zero rows
            // and this backfill would report success having linked nothing —
            // the same trap 20260815080242 documents. Lift FORCE for the
            // statement and put it straight back.
            migrationBuilder.Sql(@"
ALTER TABLE ssf.raw_blob_index NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.ai_jobs        NO FORCE ROW LEVEL SECURITY;

INSERT INTO ssf.raw_blob_subjects (sha256, user_id, first_seen_utc)
SELECT b.sha256,
       j.user_id,
       -- The blob's own first-seen timestamp is the honest value: it is when
       -- these bytes were first recorded, which is what the column means.
       -- now() would assert the subject was first seen at migration time.
       b.first_seen_utc
  FROM ssf.raw_blob_index b
  JOIN ssf.ai_jobs j
    ON (
         j.input_content_hash = b.sha256
      OR j.raw_input_ref LIKE '%' || b.sha256 || '%'
       )
 -- Never propagate a placeholder as if it were a real subject. ai_jobs.user_id
 -- is NOT NULL, so a row that never had a real owner carries the all-zero uuid;
 -- linking that would manufacture an owner out of a sentinel. Such a blob stays
 -- unlinked and is counted as unrecoverable below, which is the truth.
 WHERE j.user_id <> '00000000-0000-0000-0000-000000000000'::uuid
 -- Degenerate guard: LIKE '%' || '' || '%' matches every row. sha256 is always
 -- 64 chars (RawBlobRef enforces it), so this can only ever exclude corruption.
   AND length(b.sha256) = 64
 GROUP BY b.sha256, j.user_id, b.first_seen_utc
ON CONFLICT (sha256, user_id) DO NOTHING;

ALTER TABLE ssf.ai_jobs        FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.raw_blob_index FORCE ROW LEVEL SECURITY;
");

            // ── 3. Say out loud what could not be recovered ──────────────
            //
            // A backfill that silently leaves rows unlinked reads as done. It is
            // not done — those blobs are the pre-existing damage and the count
            // is the measurement of it. NOTICE rather than EXCEPTION on purpose:
            // unrecoverable rows are an EXPECTED pre-existing state, not a
            // failure of this migration, and raising here would block the very
            // change that stops the count from growing.
            migrationBuilder.Sql(@"
DO $$
DECLARE
    total_blobs   bigint;
    linked_blobs  bigint;
    orphan_blobs  bigint;
BEGIN
    ALTER TABLE ssf.raw_blob_index    NO FORCE ROW LEVEL SECURITY;

    SELECT count(*)                 INTO total_blobs  FROM ssf.raw_blob_index;
    SELECT count(DISTINCT s.sha256) INTO linked_blobs FROM ssf.raw_blob_subjects s;

    orphan_blobs := total_blobs - linked_blobs;

    ALTER TABLE ssf.raw_blob_index    FORCE ROW LEVEL SECURITY;

    RAISE NOTICE
        'P0.9 raw-blob subject backfill: % of % blob(s) linked to a subject; % UNRECOVERABLE (ai_jobs row already deleted — pre-existing damage; no owner was fabricated for these).',
        linked_blobs, total_blobs, orphan_blobs;
END $$;
");

            // ── 4. RLS ───────────────────────────────────────────────────
            migrationBuilder.Sql(@"
ALTER TABLE ssf.raw_blob_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.raw_blob_subjects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_user_raw_blob_subjects ON ssf.raw_blob_subjects;
CREATE POLICY p_user_raw_blob_subjects ON ssf.raw_blob_subjects
  USING      (user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid)
  WITH CHECK (true);
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "DROP POLICY IF EXISTS p_user_raw_blob_subjects ON ssf.raw_blob_subjects;");

            migrationBuilder.DropTable(
                name: "raw_blob_subjects",
                schema: "ssf");
        }
    }
}
