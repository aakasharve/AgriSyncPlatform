using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class VerificationV2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'ssf'
          AND table_name = 'verification_events'
          AND column_name = 'status'
          AND data_type = 'integer'
    ) THEN
        ALTER TABLE ssf.verification_events
            ALTER COLUMN status TYPE character varying(40)
            USING (
                CASE status
                    WHEN 1 THEN 'Verified'
                    WHEN 2 THEN 'Disputed'
                    ELSE 'Draft'
                END
            );
    END IF;

    UPDATE ssf.verification_events
    SET status = 'Verified'
    WHERE status = 'Approved';

    UPDATE ssf.verification_events
    SET status = 'Disputed'
    WHERE status = 'Rejected';
END $$;
""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
DO $$
BEGIN
    UPDATE ssf.verification_events
    SET status = 'Approved'
    WHERE status = 'Verified';

    UPDATE ssf.verification_events
    SET status = 'Rejected'
    WHERE status = 'Disputed';
END $$;
""");
        }
    }
}
