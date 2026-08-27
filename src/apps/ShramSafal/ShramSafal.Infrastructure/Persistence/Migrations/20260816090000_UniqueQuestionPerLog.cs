using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-3.3) — Ruling 1 (2026-08-15):
    /// "offline retries, reopening the app, or syncing from another device must not
    /// create duplicate questions."
    ///
    /// <para><b>Why an index and not an upsert.</b> <c>ssf.question_events</c> is
    /// append-only <i>by privilege</i> — <c>REVOKE UPDATE, DELETE ON ssf.question_events
    /// FROM agrisync_app</c> (20260713052440_AddDfesDataSpine). <c>ON CONFLICT DO UPDATE</c>
    /// is therefore unavailable to the app role, so the handler checks-then-inserts and
    /// this index is the backstop for a genuine race between two concurrent writers.</para>
    ///
    /// <para><b>Why the predicate is not optional.</b> Every row written before wave-3.1
    /// carries <c>daily_log_id IS NULL</c> — the client never sent the log id. An
    /// unfiltered unique index would collapse all of that history to one row per
    /// question key and fail to build. The partial predicate constrains only rows that
    /// actually name a log.</para>
    ///
    /// <para><b>ix_question_events_daily_log_id is deliberately left alone.</b> It already
    /// exists (20260713052440_AddDfesDataSpine, and QuestionEventConfiguration:48); this
    /// migration adds one index and drops one index, nothing else.</para>
    ///
    /// <para>Raw SQL rather than an EF model index: Postgres partial-unique semantics are
    /// the whole point here, and keeping it out of the model means the EF model — and
    /// therefore ShramSafalDbContextModelSnapshot — is unchanged by this migration.</para>
    /// </summary>
    public partial class UniqueQuestionPerLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE UNIQUE INDEX ux_question_events_log_question
                  ON ssf.question_events (daily_log_id, question_key)
                  WHERE daily_log_id IS NOT NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS ssf.ux_question_events_log_question;");
        }
    }
}
