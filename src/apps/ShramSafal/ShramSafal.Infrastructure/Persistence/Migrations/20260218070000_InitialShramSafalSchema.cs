using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    [DbContext(typeof(ShramSafalDbContext))]
    [Migration("20260218070000_InitialShramSafalSchema")]
    public partial class InitialShramSafalSchema : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
"""
CREATE SCHEMA IF NOT EXISTS ssf;

CREATE TABLE IF NOT EXISTS ssf.cost_entries (
    "Id" uuid PRIMARY KEY,
    farm_id uuid NOT NULL,
    plot_id uuid NULL,
    crop_cycle_id uuid NULL,
    category character varying(80) NOT NULL,
    description character varying(500) NOT NULL,
    amount numeric(18,2) NOT NULL,
    currency_code character varying(8) NOT NULL,
    entry_date date NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at_utc timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS ssf.verification_events (
    "Id" uuid PRIMARY KEY,
    daily_log_id uuid NOT NULL,
    status character varying(20) NOT NULL,
    reason character varying(400) NULL,
    verified_by_user_id uuid NOT NULL,
    occurred_at_utc timestamp with time zone NOT NULL
);
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
"""
DROP TABLE IF EXISTS ssf.verification_events;
DROP TABLE IF EXISTS ssf.cost_entries;
""");
        }
    }
}
