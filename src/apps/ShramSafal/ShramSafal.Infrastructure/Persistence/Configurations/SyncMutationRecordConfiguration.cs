using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class SyncMutationRecordConfiguration : IEntityTypeConfiguration<SyncMutationRecord>
{
    public void Configure(EntityTypeBuilder<SyncMutationRecord> builder)
    {
        builder.ToTable("sync_mutations");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.DeviceId)
            .HasColumnName("device_id")
            .HasMaxLength(120)
            .IsRequired();

        builder.Property(x => x.ClientRequestId)
            .HasColumnName("client_request_id")
            .HasMaxLength(150)
            .IsRequired();

        builder.Property(x => x.MutationType)
            .HasColumnName("mutation_type")
            .HasMaxLength(80)
            .IsRequired();

        builder.Property(x => x.ResponsePayloadJson)
            .HasColumnName("response_payload_json")
            .HasColumnType("text")
            .IsRequired();

        builder.Property(x => x.ProcessedAtUtc)
            .HasColumnName("processed_at_utc")
            .IsRequired();

        builder.HasIndex(x => new { x.DeviceId, x.ClientRequestId })
            .IsUnique();
    }
}
