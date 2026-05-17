// spec: data-principle-spine-2026-05-05/05.6
using ShramSafal.Domain.Privacy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.6 — EF mapping for
/// <see cref="CrossBorderTransfer"/>. Default <c>ssf</c> schema applied
/// by <c>ShramSafalDbContext.OnModelCreating</c>. The table is
/// deliberately FK-free (see entity remarks) so deletion of an
/// <c>AiJob</c> or <c>Farm</c> never cascades into the audit log.
///
/// <para>
/// Index <c>(occurred_at_utc, destination_region)</c> per plan §05.6.1
/// — the Phase-08 export aggregates daily transfers by destination
/// region so the leading columns match the primary read pattern.
/// </para>
/// </summary>
internal sealed class CrossBorderTransferConfiguration : IEntityTypeConfiguration<CrossBorderTransfer>
{
    public void Configure(EntityTypeBuilder<CrossBorderTransfer> b)
    {
        b.ToTable("cross_border_transfers");
        b.HasKey(x => x.Id);

        b.Property(x => x.Id)
            .HasColumnName("id")
            .IsRequired();

        b.Property(x => x.OccurredAtUtc)
            .HasColumnName("occurred_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired();

        b.Property(x => x.DestinationRegion)
            .HasColumnName("destination_region")
            .HasMaxLength(32)
            .IsRequired();

        b.Property(x => x.DestinationVendor)
            .HasColumnName("destination_vendor")
            .HasMaxLength(128)
            .IsRequired();

        b.Property(x => x.PayloadClass)
            .HasColumnName("payload_class")
            .HasMaxLength(64)
            .IsRequired();

        b.Property(x => x.SourceAiJobId)
            .HasColumnName("source_ai_job_id")
            .IsRequired(false);

        b.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .IsRequired(false);

        b.Property(x => x.ConsentTokenKid)
            .HasColumnName("consent_token_kid")
            .HasMaxLength(128)
            .IsRequired(false);

        b.Property(x => x.PayloadSizeBytes)
            .HasColumnName("payload_size_bytes")
            .IsRequired();

        b.HasIndex(x => new { x.OccurredAtUtc, x.DestinationRegion })
            .HasDatabaseName("ix_cross_border_transfers_occurred_destination");
    }
}
