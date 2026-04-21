using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace User.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// CEI Phase 2 — I7: Pinpoint migration for additive AppRole values (Agronomist=4 .. LabOperator=8).
    ///
    /// Case A — role column is varchar(30), NOT a Postgres enum type.
    /// No DDL change is required: the new string values ("Agronomist", "Consultant",
    /// "FpcTechnicalManager", "FieldScout", "LabOperator") are valid immediately
    /// because the column accepts any string within the 30-char limit.
    ///
    /// This migration is intentionally empty.  It acts as a pinpoint in the
    /// migration history so that:
    ///   (a) the EF model snapshot reflects the updated AppRole enum metadata, and
    ///   (b) staging/production apply a no-op migration that is fast and safe.
    /// </summary>
    public partial class CeiRoleValuesPinpoint : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // No-op: AppRole is persisted as varchar(30).
            // New values 4–8 require no DDL — see class doc for rationale.
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // No-op: nothing was changed in Up.
        }
    }
}
