using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// <c>ssf.field_operator_work_rows</c> was created with NO grant to the
    /// application role. Only <c>postgres</c> could touch it, so every code path
    /// that reads or writes it died with
    /// <c>42501: permission denied for table field_operator_work_rows</c>.
    ///
    /// <para>That is not a latent risk, it is a dead feature. The attach endpoint
    /// (<c>POST /farms/{farmId}/labour/field-operators/{id}/attach</c>) is the one
    /// way to record that a named worker did a given engagement — the save path
    /// behind the whole हजेरी question — and it could never have succeeded once
    /// under the app role. Nothing surfaced it because nothing had read the table
    /// either, so the failure had no reader to fail in front of.</para>
    ///
    /// <para>The grants mirror <c>ssf.labour_assignments</c> exactly, which is the
    /// sibling table this one hangs off: full DML for <c>agrisync_app</c>, SELECT
    /// for <c>agrisync_readonly</c>. Deliberately NOT broader — no TRUNCATE or
    /// REFERENCES beyond what the sibling already carries.</para>
    ///
    /// <para>RLS is unaffected. A grant is not a bypass: the row-level policies on
    /// this table still decide which rows the app may see, and this only restores
    /// the table-level permission without which those policies are never even
    /// consulted.</para>
    /// </summary>
    public partial class GrantFieldOperatorWorkRowsToAppRole : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // IF EXISTS on the roles: CI and local databases are provisioned by
            // the same migration chain but do not all carry both roles, and a
            // missing role must not fail the deploy.
            migrationBuilder.Sql(@"
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.field_operator_work_rows TO agrisync_app;
            END IF;

            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_readonly') THEN
                GRANT SELECT ON ssf.field_operator_work_rows TO agrisync_readonly;
            END IF;
        END
        $$;
        ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
                REVOKE SELECT, INSERT, UPDATE, DELETE ON ssf.field_operator_work_rows FROM agrisync_app;
            END IF;

            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_readonly') THEN
                REVOKE SELECT ON ssf.field_operator_work_rows FROM agrisync_readonly;
            END IF;
        END
        $$;
        ");
        }
    }
}
