using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class ApplicationInputItemConfiguration : IEntityTypeConfiguration<ApplicationInputItem>
{
    public void Configure(EntityTypeBuilder<ApplicationInputItem> builder)
    {
        builder.ToTable("application_input_items");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.OperationId).HasColumnName("operation_id").IsRequired();

        builder.Property(x => x.ProductName).HasColumnName("product_name").HasMaxLength(200).IsRequired();
        builder.Property(x => x.ProductType).HasColumnName("product_type").HasMaxLength(60);
        builder.Property(x => x.NpkGrade).HasColumnName("npk_grade").HasMaxLength(20);

        builder.Property(x => x.DoseAmount).HasColumnName("dose_amount");
        builder.Property(x => x.DoseUnit).HasColumnName("dose_unit").HasMaxLength(20);
        builder.Property(x => x.DoseBasisQty).HasColumnName("dose_basis_qty");
        builder.Property(x => x.DoseBasisUnit).HasColumnName("dose_basis_unit").HasMaxLength(20);

        builder.Property(x => x.Ordinal).HasColumnName("ordinal").IsRequired();
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();

        // ── wave-3.12, spec Ruling 5 — certainty is a DIFFERENT AXIS from
        // provenance (doctrine P8), so it gets its own nullable columns rather than
        // overloading anything that already exists. Stored as the enum NAME, matching
        // every other enum on these tables, so the column reads honestly in psql.
        // NULL on every row written before this migration and on every row nobody was
        // asked about — never defaulted to Reported (P4).
        builder.Property(x => x.DoseCertainty)
            .HasColumnName("dose_certainty").HasConversion<string>().HasMaxLength(20);
        builder.Property(x => x.DoseSpokenText)
            .HasColumnName("dose_spoken_text").HasMaxLength(200);

        // spec: facts-card-input-truth-2026-11-19 (lane FACTS) - additive, nullable: how it was applied and the carrier water, as the
        // record states them. NULL on every row written before this migration and wherever the record is silent (P4).
        builder.Property(x => x.Method).HasColumnName("method").HasMaxLength(40);
        builder.Property(x => x.CarrierWaterLitres).HasColumnName("carrier_water_litres").HasPrecision(12, 2);

        builder.HasIndex(x => x.OperationId).HasDatabaseName("ix_application_input_items_operation_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
