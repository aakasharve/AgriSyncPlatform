using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// DWC v2 §3.3 — Work Trust Ledger v0: <c>ssf.workers</c> +
    /// <c>ssf.worker_assignments</c> tables and supporting indexes.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Decision: ADR <c>2026-05-04 wtl-v0-entity-shape</c>. Two thin
    /// entities populated by a server-side projector that consumes
    /// transcripts on <see cref="ShramSafal.Domain.Logs.DailyLog"/>.
    /// NEVER farmer-facing in v0.
    /// </para>
    /// <para>
    /// <b>Idempotency.</b> <see cref="Up"/> uses
    /// <c>CREATE TABLE IF NOT EXISTS</c> / <c>CREATE INDEX IF NOT
    /// EXISTS</c> so a second run is a no-op — same discipline as
    /// <c>20260502000000_AnalyticsRewrite</c>.
    /// </para>
    /// <para>
    /// <b>Forward-only.</b> <see cref="Down"/> raises an exception
    /// rather than dropping the tables. Production rollback is via DB
    /// snapshot restore per
    /// <c>_COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md</c>;
    /// local-dev cleanup is via <c>dotnet ef database drop</c>. This
    /// matches the precedent set by
    /// <c>20260502000000_AnalyticsRewrite.Down()</c>.
    /// </para>
    /// </remarks>
    [DbContext(typeof(ShramSafalDbContext))]
    [Migration("20260504000000_WtlV0Entities")]
    public partial class WtlV0Entities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE IF NOT EXISTS ssf.workers (
                    "Id"              uuid PRIMARY KEY,
                    farm_id           uuid NOT NULL,
                    name_raw          varchar(200) NOT NULL,
                    name_normalized   varchar(200) NOT NULL,
                    first_seen_utc    timestamptz  NOT NULL,
                    assignment_count  integer      NOT NULL DEFAULT 0,
                    CONSTRAINT fk_workers_farm
                        FOREIGN KEY (farm_id) REFERENCES ssf.farms("Id") ON DELETE CASCADE
                );
                """);

            migrationBuilder.Sql("""
                CREATE INDEX IF NOT EXISTS ix_workers_farm_normalized
                    ON ssf.workers (farm_id, name_normalized);
                """);

            migrationBuilder.Sql("""
                CREATE TABLE IF NOT EXISTS ssf.worker_assignments (
                    "Id"             uuid PRIMARY KEY,
                    worker_id        uuid          NOT NULL,
                    daily_log_id     uuid          NOT NULL,
                    confidence       numeric(3, 2) NOT NULL,
                    occurred_at_utc  timestamptz   NOT NULL,
                    CONSTRAINT fk_worker_assignments_workers_worker_id
                        FOREIGN KEY (worker_id) REFERENCES ssf.workers("Id") ON DELETE CASCADE
                );
                """);

            migrationBuilder.Sql("""
                CREATE INDEX IF NOT EXISTS ix_worker_assignments_log
                    ON ssf.worker_assignments (daily_log_id);
                """);

            migrationBuilder.Sql("""
                CREATE INDEX IF NOT EXISTS ix_worker_assignments_worker
                    ON ssf.worker_assignments (worker_id);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    RAISE EXCEPTION 'WtlV0Entities is forward-only. Roll back via DB snapshot restore (RDS_PROVISIONING.md) or `dotnet ef database drop` for local dev.';
                END;
                $$;
                """);
        }
    }
}
