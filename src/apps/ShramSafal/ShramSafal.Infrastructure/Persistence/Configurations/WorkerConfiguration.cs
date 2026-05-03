using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Wtl;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// EF mapping for the Work Trust Ledger v0 <see cref="Worker"/> aggregate.
/// </summary>
/// <remarks>
/// DWC v2 §3.3 / ADR <c>2026-05-04 wtl-v0-entity-shape</c>.
/// </remarks>
internal sealed class WorkerConfiguration : IEntityTypeConfiguration<Worker>
{
    public void Configure(EntityTypeBuilder<Worker> builder)
    {
        builder.ToTable("workers");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.OwnsOne(x => x.Name, name =>
        {
            name.Property(p => p.Raw)
                .HasColumnName("name_raw")
                .HasMaxLength(200)
                .IsRequired();

            name.Property(p => p.Normalized)
                .HasColumnName("name_normalized")
                .HasMaxLength(200)
                .IsRequired();
        });

        builder.Property(x => x.FirstSeenUtc)
            .HasColumnName("first_seen_utc")
            .IsRequired();

        builder.Property(x => x.AssignmentCount)
            .HasColumnName("assignment_count")
            .HasDefaultValue(0)
            .IsRequired();

        // FK -> ssf.farms (ON DELETE CASCADE) and the composite lookup
        // index ix_workers_farm_normalized (farm_id, name_normalized)
        // are created directly in the WtlV0Entities migration SQL —
        // EF Core 10's HasIndex does not traverse owned-type
        // properties, and the projector's find-or-create path needs
        // the index to live in the DB regardless.
    }
}
