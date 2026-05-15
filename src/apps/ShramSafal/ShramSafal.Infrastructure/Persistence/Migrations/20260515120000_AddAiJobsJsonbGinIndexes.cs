// spec: data-principle-spine-2026-05-05
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Sub-phase 02.4 of the Data Principle Spine — adds GIN indexes on the two
    /// JSONB columns of <c>ssf.ai_jobs</c> (<c>normalized_result_json</c>,
    /// <c>input_session_metadata_json</c>) so forensic <c>@&gt;</c> / <c>?</c> /
    /// <c>?|</c> queries hit indexes instead of seqscans.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Idempotent:</b> <c>CREATE INDEX IF NOT EXISTS</c> makes re-applying
    /// safe (e.g. partially-stamped local-dev databases).
    /// </para>
    /// <para>
    /// <b>Reversible:</b> matches the 02.2 / 02.3 mini-spike reversibility
    /// pattern (<c>20260515100000_AddRawBlobIndex</c>,
    /// <c>20260515110000_AddTranscripts</c>). This is index-only DDL — no data
    /// loss on rollback.
    /// </para>
    /// <para>
    /// <b>No CONCURRENTLY:</b> EF Core wraps each migration in a transaction;
    /// <c>CREATE INDEX CONCURRENTLY</c> cannot run inside a transaction.
    /// Production rollout strategy is non-CONCURRENT for this spike
    /// (<c>ai_jobs</c> is small); a future hot-path index migration may need
    /// <c>SuppressTransaction = true</c>.
    /// </para>
    /// </remarks>
    public partial class AddAiJobsJsonbGinIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
CREATE INDEX IF NOT EXISTS ix_ai_jobs_normalized_result_gin
  ON ssf.ai_jobs USING GIN (normalized_result_json);
CREATE INDEX IF NOT EXISTS ix_ai_jobs_session_metadata_gin
  ON ssf.ai_jobs USING GIN (input_session_metadata_json);
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP INDEX IF EXISTS ssf.ix_ai_jobs_normalized_result_gin;
DROP INDEX IF EXISTS ssf.ix_ai_jobs_session_metadata_gin;
");
        }
    }
}
