using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFarmGeographyFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "canonical_centre_lat",
                schema: "ssf",
                table: "farms",
                type: "double precision",
                precision: 10,
                scale: 7,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "canonical_centre_lng",
                schema: "ssf",
                table: "farms",
                type: "double precision",
                precision: 10,
                scale: 7,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "centre_source",
                schema: "ssf",
                table: "farms",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "geo_validation_status",
                schema: "ssf",
                table: "farms",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                defaultValue: "Unchecked");

            migrationBuilder.AddColumn<decimal>(
                name: "total_govt_area_acres",
                schema: "ssf",
                table: "farms",
                type: "numeric(18,4)",
                precision: 18,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "total_mapped_area_acres",
                schema: "ssf",
                table: "farms",
                type: "numeric(18,4)",
                precision: 18,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "weather_radius_km",
                schema: "ssf",
                table: "farms",
                type: "double precision",
                precision: 8,
                scale: 3,
                nullable: false,
                defaultValue: 3.0);

            migrationBuilder.CreateTable(
                name: "farm_boundaries",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    polygon_geo_json = table.Column<string>(type: "jsonb", nullable: false),
                    calculated_area_acres = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: false),
                    source = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    archived_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_farm_boundaries", x => x.id);
                    table.ForeignKey(
                        name: "FK_farm_boundaries_farms_farm_id",
                        column: x => x.farm_id,
                        principalSchema: "ssf",
                        principalTable: "farms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_farms_owner_account_id_id",
                schema: "ssf",
                table: "farms",
                columns: new[] { "owner_account_id", "Id" });

            migrationBuilder.CreateIndex(
                name: "ix_farm_boundaries_farm_id_is_active",
                schema: "ssf",
                table: "farm_boundaries",
                columns: new[] { "farm_id", "is_active" });

            migrationBuilder.CreateIndex(
                name: "ix_farm_boundaries_owner_account_id_farm_id",
                schema: "ssf",
                table: "farm_boundaries",
                columns: new[] { "owner_account_id", "farm_id" });

            migrationBuilder.CreateIndex(
                name: "ux_farm_boundaries_active_farm_id",
                schema: "ssf",
                table: "farm_boundaries",
                column: "farm_id",
                unique: true,
                filter: "is_active = TRUE");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "farm_boundaries",
                schema: "ssf");

            migrationBuilder.DropIndex(
                name: "ix_farms_owner_account_id_id",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropColumn(
                name: "canonical_centre_lat",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropColumn(
                name: "canonical_centre_lng",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropColumn(
                name: "centre_source",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropColumn(
                name: "geo_validation_status",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropColumn(
                name: "total_govt_area_acres",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropColumn(
                name: "total_mapped_area_acres",
                schema: "ssf",
                table: "farms");

            migrationBuilder.DropColumn(
                name: "weather_radius_km",
                schema: "ssf",
                table: "farms");
        }
    }
}
